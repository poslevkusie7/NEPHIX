import os
import uuid
from typing import Any, Dict, Optional

import streamlit as st
import pandas as pd
from assistant_core import (
    TaskManager,
    EssayAssistantTask,
    ReadingAssistantTask,
    configure_llm,
    is_llm_configured,
    infer_essay_parameters_from_text,
    task_from_state,
)
from auth import (
    exchange_code_for_token,
    fetch_userinfo,
    generate_state_and_nonce,
    get_authorization_url,
    get_google_config,
)
from db import (
    create_assignment,
    create_submission,
    delete_submission,
    ensure_schema,
    get_assignment,
    get_database_url,
    get_or_create_user,
    get_submission_for_assignment_user,
    list_submissions_for_user,
    update_submission_state,
)

# --------- Custom CSS ---------
def inject_custom_css():
    st.markdown("""
    <style>
    /* Button Colors Mapping */
    
    /* "Set Thesis" / "Save" - Greenish #A3B9A5 */
    div[data-testid="stButton"] button:has(div:contains("Set thesis")),
    div[data-testid="stButton"] button:has(div:contains("Save")) {
        background-color: #A3B9A5 !important;
        color: white !important;
        border: none;
    }

    /* "Next Stage" / "Switch Text" - Orange #F59E0B */
    div[data-testid="stButton"] button:has(div:contains("Next stage")),
    div[data-testid="stButton"] button:has(div:contains("Switch text")), 
    div[data-testid="stButton"] button:has(div:contains("Generate outline")) {
        background-color: #F59E0B !important;
        color: white !important;
        border: none;
    }

    /* "Continue here" - Blue #5BA4E6 */
    div[data-testid="stButton"] button:has(div:contains("Continue here")) {
        background-color: #5BA4E6 !important;
        color: white !important;
        border: none;
    }
    
    /* Back Buttons */
    div[data-testid="stButton"] button:has(div:contains("Back")) {
        background-color: #f0f2f6;
        color: #31333F;
    }
    </style>
    """, unsafe_allow_html=True)

# --------- Session State ---------
if "task_manager" not in st.session_state:
    st.session_state.task_manager = TaskManager()
if "current_task_id" not in st.session_state:
    st.session_state.current_task_id = None
if "app_mode" not in st.session_state:
    st.session_state.app_mode = "Create New Task"
if "create_step" not in st.session_state:
    st.session_state.create_step = "choose_type"
if "create_task_type" not in st.session_state:
    st.session_state.create_task_type = "Essay Task"
if "_app_mode_override" not in st.session_state:
    st.session_state._app_mode_override = None
if "db_ready" not in st.session_state:
    st.session_state.db_ready = False
if "user" not in st.session_state:
    st.session_state.user = None
if "oauth_state" not in st.session_state:
    st.session_state.oauth_state = None
if "oauth_nonce" not in st.session_state:
    st.session_state.oauth_nonce = None
if "last_assignment_id" not in st.session_state:
    st.session_state.last_assignment_id = None


def _normalize_query_params(params: Dict[str, Any]) -> Dict[str, str]:
    normalized: Dict[str, str] = {}
    for key, value in params.items():
        if isinstance(value, list):
            normalized[key] = value[0] if value else ""
        else:
            normalized[key] = value
    return normalized


def get_query_params() -> Dict[str, str]:
    try:
        return _normalize_query_params(dict(st.query_params))
    except Exception:
        return _normalize_query_params(st.experimental_get_query_params())


def set_query_params(params: Dict[str, str]) -> None:
    try:
        st.query_params.clear()
        st.query_params.update(params)
    except Exception:
        st.experimental_set_query_params(**params)


def ensure_db_config() -> None:
    if get_database_url():
        return
    if "DATABASE_URL" in st.secrets:
        os.environ["DATABASE_URL"] = st.secrets["DATABASE_URL"]


def require_db() -> None:
    ensure_db_config()
    if not get_database_url():
        st.error("DATABASE_URL is not set. Add it to your environment or Streamlit secrets.")
        st.stop()
    if not st.session_state.db_ready:
        try:
            ensure_schema()
            st.session_state.db_ready = True
        except Exception as e:
            st.error(f"Database init failed: {e}")
            st.stop()


def get_app_base_url() -> str:
    return os.getenv("APP_BASE_URL", "http://localhost:8501").rstrip("/")


def require_login() -> Dict[str, Any]:
    if st.session_state.user:
        return st.session_state.user

    cfg = get_google_config()
    if not cfg["client_id"] or not cfg["client_secret"]:
        st.error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.")
        st.stop()

    qp = get_query_params()
    code = qp.get("code")
    state = qp.get("state")
    if code and state:
        if state != st.session_state.oauth_state:
            st.error("OAuth state mismatch. Please try logging in again.")
            st.session_state.oauth_state = None
            st.session_state.oauth_nonce = None
            st.stop()
        try:
            token = exchange_code_for_token(code)
            info = fetch_userinfo(token)
            user = get_or_create_user(info["email"], info.get("name"), info.get("picture"))
            st.session_state.user = user
            for key in ("code", "state", "scope", "authuser", "prompt"):
                qp.pop(key, None)
            set_query_params(qp)
            st.rerun()
        except Exception as e:
            st.error(f"Login failed: {e}")
            st.stop()

    if not st.session_state.oauth_state or not st.session_state.oauth_nonce:
        state, nonce = generate_state_and_nonce()
        st.session_state.oauth_state = state
        st.session_state.oauth_nonce = nonce

    auth_url = get_authorization_url(st.session_state.oauth_state, st.session_state.oauth_nonce)
    st.title("Login Required")
    st.markdown("Please sign in with Google to continue.")
    try:
        st.link_button("Continue with Google", auth_url)
    except Exception:
        st.markdown(f"[Continue with Google]({auth_url})")
    st.stop()


def sign_out():
    for key in ("user", "oauth_state", "oauth_nonce", "current_task_id"):
        if key in st.session_state:
            st.session_state[key] = None
    st.rerun()


def sync_tasks_from_db(manager: TaskManager, user_id: str) -> None:
    manager.tasks = {}
    for row in list_submissions_for_user(user_id):
        state = row.get("state", {})
        if not isinstance(state, dict):
            continue
        try:
            task = task_from_state(state)
            manager.tasks[task.id] = task
        except Exception:
            continue


def persist_task_state(task) -> None:
    update_submission_state(task.id, task.to_state())


def handle_assignment_link(manager: TaskManager, user_id: str) -> None:
    qp = get_query_params()
    assignment_id = qp.get("assignment")
    if not assignment_id:
        return

    assignment = get_assignment(assignment_id)
    if not assignment or not assignment.get("active", True):
        st.warning("This assignment is not available.")
        return

    submission = get_submission_for_assignment_user(assignment_id, user_id)
    if submission:
        state = submission.get("state", {})
        if isinstance(state, dict):
            try:
                task = task_from_state(state)
                manager.tasks[task.id] = task
                st.session_state.current_task_id = task.id
                st.session_state._app_mode_override = "Work on Task"
            except Exception:
                pass
        return

    task_type = assignment.get("task_type")
    params = assignment.get("params", {})
    submission_id = str(uuid.uuid4())
    if task_type == "essay":
        task = EssayAssistantTask(params, task_id=submission_id)
    else:
        task = ReadingAssistantTask(params, task_id=submission_id)
    task.start()
    create_submission(assignment_id, user_id, task.to_state(), submission_id=submission_id)
    manager.tasks[task.id] = task
    st.session_state.current_task_id = task.id
    st.session_state._app_mode_override = "Work on Task"


def render_share_link() -> None:
    if not st.session_state.last_assignment_id:
        return
    share_url = f"{get_app_base_url()}?assignment={st.session_state.last_assignment_id}"
    st.info("Share this assignment link:")
    st.code(share_url)

# --------- Sidebar: Tasks & Settings ---------
def sidebar_ui(show_tasks: bool, manager: TaskManager, user: Dict[str, Any]):
    st.sidebar.title("🤖 Assistant")
    st.sidebar.caption(f"Signed in as {user.get('email')}")
    if st.sidebar.button("Sign out"):
        sign_out()
    
    # LLM Setup - xAI ONLY
    with st.sidebar.expander("⚙️ xAI Settings", expanded=True):
        use_llm = st.checkbox("Enable xAI", value=True)
        
        # Only ask for Key and Model (defaulted to Grok)
        api_key = st.text_input("xAI API Key", type="password", help="Starts with 'xai-...'")
        model_name = st.text_input("Model", value="grok-beta")

        # Configure the backend
        configure_llm(
            enabled=use_llm, 
            api_key=api_key if api_key else None, 
            model=model_name
        )

        # TEST BUTTON
        if st.button("🔌 Test xAI Connection"):
            if not api_key:
                st.error("Please enter an xAI API Key first.")
            else:
                try:
                    from assistant_core import call_llm
                    with st.spinner("Connecting to Grok..."):
                        resp = call_llm("Say 'xAI Connection Successful'", temperature=0.1)
                        st.success(f"{resp}")
                except Exception as e:
                    st.error(f"Connection Failed:\n{e}")

    st.sidebar.divider()
    if not show_tasks:
        st.sidebar.caption("Choose Work on Task to view and manage tasks.")
        return
    
    # Task List
    st.sidebar.subheader("Tasks")
    tasks = manager.get_all_tasks()
    
    if not tasks:
        st.sidebar.info("No tasks yet.")
    
    for t in tasks:
        is_active = (st.session_state.current_task_id == t['id'])
        label = "Essay Task" if t["type"] == "EssayAssistantTask" else "Reading Task" if t["type"] == "ReadingAssistantTask" else t["type"]
        
        if is_active:
            c = st.sidebar.container()
            c.markdown(f"✅ **{label}**")
            c.caption(f"ID: {t['id']}")
        else:
            col1, col2 = st.sidebar.columns([4, 1])
            if col1.button(f"{label} \n {t['id'][:6]}...", key=t['id']):
                st.session_state.current_task_id = t['id']
                st.rerun()
            if col2.button("🗑️", key=f"del_{t['id']}"):
                delete_submission(t["id"], user["id"])
                manager.delete_task(t['id'])
                if is_active:
                    st.session_state.current_task_id = None
                st.rerun()
        
        if is_active:
            st.sidebar.markdown("---")

def render_create_flow(manager: TaskManager, user: Dict[str, Any]):
    if st.session_state.create_step not in {"choose_type", "essay_form", "reading_form"}:
        st.session_state.create_step = "choose_type"

    if st.session_state.create_step == "choose_type":
        st.subheader("Choose Task Type")
        st.radio("Task Type", ["Essay Task", "Reading Task"], horizontal=True, key="create_task_type")
        col1, col2 = st.columns([1, 4])
        if col1.button("Continue ▶"):
            if st.session_state.create_task_type == "Essay Task":
                st.session_state.create_step = "essay_form"
            else:
                st.session_state.create_step = "reading_form"
            st.rerun()
        return

    if st.session_state.create_step == "essay_form":
        col_back, _ = st.columns([1, 5])
        if col_back.button("◀ Back"):
            st.session_state.create_step = "choose_type"
            st.rerun()

        st.subheader("Create Essay Task")
        desc = st.text_area("Paste assignment description (optional)")
        
        # Auto-fill button with Error Handling
        if st.button("✨ Auto-fill from text"):
            if desc and is_llm_configured():
                try:
                    with st.spinner("Analyzing text with Grok..."):
                        params = infer_essay_parameters_from_text(desc)
                        st.session_state['new_essay_params'] = params
                        st.success("Parameters extracted!")
                except Exception as e:
                    st.error(f"Auto-fill failed: {e}")
            elif not desc:
                st.warning("Please paste description text first.")
            else:
                st.error("xAI is not configured.")
        
        defaults = st.session_state.get('new_essay_params', {})
        
        with st.form("new_essay"):
            topic = st.text_input("Topic", value=defaults.get('topic', ''))
            e_type = st.selectbox(
                "Type",
                ["opinion", "analytical", "comparative"],
                index=0 if defaults.get('essay_type')=='opinion' else 1
            )
            wc = st.number_input("Word Count", value=defaults.get('word_count', 500))
            if st.form_submit_button("Create Essay Task"):
                params = {"topic": topic, "essay_type": e_type, "word_count": wc}
                assignment_id = str(uuid.uuid4())
                create_assignment("essay", params, user["id"], assignment_id=assignment_id)

                submission_id = str(uuid.uuid4())
                task = EssayAssistantTask(params, task_id=submission_id)
                task.start()
                create_submission(assignment_id, user["id"], task.to_state(), submission_id=submission_id)
                manager.tasks[task.id] = task

                st.session_state.current_task_id = task.id
                st.session_state.last_assignment_id = assignment_id
                st.session_state._app_mode_override = "Work on Task"
                st.session_state.create_step = "choose_type"
                st.success("Task Created!")
                st.rerun()
        return

    if st.session_state.create_step == "reading_form":
        col_back, _ = st.columns([1, 5])
        if col_back.button("◀ Back"):
            st.session_state.create_step = "choose_type"
            st.rerun()

        st.subheader("Create Reading Task")
        if 'num_texts' not in st.session_state:
            st.session_state.num_texts = 2
        
        texts_input = []
        for i in range(st.session_state.num_texts):
            st.markdown(f"**Text {i+1}**")
            title = st.text_input(f"Title {i+1}", key=f"rt_{i}")
            content = st.text_area(f"Content {i+1}", key=f"rc_{i}")
            texts_input.append({"title": title, "text": content})
        
        if st.button("Add another text"):
            st.session_state.num_texts += 1
            st.rerun()
        
        if st.button("Create Reading Task"):
            valid_texts = [t for t in texts_input if t['text'].strip()]
            if valid_texts:
                params = {"texts": valid_texts}
                assignment_id = str(uuid.uuid4())
                create_assignment("reading", params, user["id"], assignment_id=assignment_id)

                submission_id = str(uuid.uuid4())
                task = ReadingAssistantTask(params, task_id=submission_id)
                task.start()
                create_submission(assignment_id, user["id"], task.to_state(), submission_id=submission_id)
                manager.tasks[task.id] = task

                st.session_state.current_task_id = task.id
                st.session_state.last_assignment_id = assignment_id
                st.session_state._app_mode_override = "Work on Task"
                st.session_state.create_step = "choose_type"
                st.rerun()
        return

def render_work_flow(manager: TaskManager):
    if not st.session_state.current_task_id:
        st.info("Please select or create a task.")
        return

    task = manager.get_task(st.session_state.current_task_id)
    if not task:
        st.error("Task not found.")
        return

    if isinstance(task, EssayAssistantTask):
        render_essay_ui(task, persist_task_state)
    elif isinstance(task, ReadingAssistantTask):
        render_reading_ui(task, persist_task_state)

# --------- Main UI ---------
def main():
    st.set_page_config(layout="wide", page_title="Essay & Reading Assistant")
    inject_custom_css()
    require_db()
    user = require_login()

    manager = st.session_state.task_manager
    handle_assignment_link(manager, user["id"])
    sync_tasks_from_db(manager, user["id"])

    if st.session_state._app_mode_override:
        st.session_state.app_mode = st.session_state._app_mode_override
        st.session_state._app_mode_override = None
    mode = st.radio(
        "Mode",
        ["Create New Task", "Work on Task"],
        horizontal=True,
        key="app_mode"
    )
    render_share_link()
    sidebar_ui(show_tasks=(mode == "Work on Task"), manager=manager, user=user)
    
    if mode == "Create New Task":
        render_create_flow(manager, user)
    else:
        render_work_flow(manager)

# --------- Essay UI Implementation ---------
def render_essay_ui(task: EssayAssistantTask, persist_fn):
    data = task.essay_data
    stage = task.current_stage_idx
    
    st.markdown(f"### 📄 {task.stage_names[stage]}")
    st.caption(f"Topic: **{data.topic}** | Type: {data.essay_type} | Target: {data.word_count} words")
    st.progress((stage + 1) / 4)
    st.divider()

    # --- Stage 1: Pick Ideas ---
    if stage == 0:
        st.info("Enter your thesis statement (1-2 sentences).")
        
        # Suggestions with Error Handling
        if is_llm_configured():
            if st.button("💡 Get xAI Suggestions"):
                try:
                    with st.spinner("Asking Grok..."):
                        task.generate_thesis_suggestions()
                        if not task.essay_data.thesis_suggestions:
                            st.warning("Grok didn't return a list. Try again.")
                        else:
                            persist_fn(task)
                            st.rerun()
                except Exception as e:
                    st.error(f"xAI Error: {e}")
        
        if data.thesis_suggestions:
            st.markdown("### 🤖 Suggestions:")
            for s in data.thesis_suggestions:
                st.info(f"• {s}")
        
        st.markdown("---")
        new_thesis = st.text_area("Your Thesis", value=data.thesis)
        
        col1, col2 = st.columns([1, 4])
        if col1.button("Set thesis"): 
            task.set_thesis(new_thesis)
            persist_fn(task)
            st.success("Thesis set!")
            st.rerun()
            
        if col2.button("Next stage ▶"): 
            try:
                task.next_stage()
                persist_fn(task)
                st.rerun()
            except Exception as e:
                st.error(str(e))

    # --- Stage 2: Organize ---
    elif stage == 1:
        st.write("Edit your outline below.")
        
        if data.outline:
            outline_data = [
                {"title": s.title, "word_count": s.word_count, "guiding_question": s.guiding_question, "id": s.id}
                for s in data.outline.sections
            ]
            edited_data = st.data_editor(
                outline_data, 
                num_rows="dynamic", 
                column_config={
                    "title": "Section Title",
                    "word_count": st.column_config.NumberColumn("Words", min_value=0, max_value=5000),
                    "guiding_question": "Guiding Question",
                    "id": None 
                },
                use_container_width=True
            )
            task.update_outline(edited_data)
            persist_fn(task)
        
        col_back, col_next = st.columns([1, 4])
        if col_back.button("◀ Back"):
            task.prev_stage()
            persist_fn(task)
            st.rerun()
            
        if col_next.button("Generate outline & go to Write stage"): 
            try:
                task.next_stage()
                persist_fn(task)
                st.rerun()
            except Exception as e:
                st.error(str(e))

    # --- Stage 3: Write ---
    elif stage == 2:
        st.write("Fill content for each section.")
        
        col_back, col_next = st.columns([1, 4])
        if col_back.button("◀ Back"):
            task.prev_stage()
            persist_fn(task)
            st.rerun()
        if col_next.button("All sections done Revise"): 
            try:
                task.next_stage()
                persist_fn(task)
                st.rerun()
            except ValueError as e:
                st.error(str(e))
        
        st.divider()

        for i, sec in enumerate(data.sections):
            with st.expander(f"{sec.title} ({sec.target_words} words)", expanded=not sec.completed):
                st.caption(sec.guiding_question)
                
                if sec.tree_prompts:
                    st.markdown("#### TREE structure:")
                    prompts = sec.tree_prompts
                    st.markdown(f"<span style='color:#7E2A8A'><b>T</b></span>: {prompts.get('T','')}", unsafe_allow_html=True)
                    st.markdown(f"<span style='color:#E69543'><b>R</b></span>: {prompts.get('R','')}", unsafe_allow_html=True)
                    st.markdown(f"<span style='color:#5DAA4F'><b>E</b></span>: {prompts.get('E1','')}", unsafe_allow_html=True)
                    st.markdown(f"<span style='color:#E03A2D'><b>E</b></span>: {prompts.get('E2','')}", unsafe_allow_html=True)
                
                val = st.text_area(f"Content for {sec.title}", value=sec.content, height=150, key=f"sec_{sec.id}")
                
                if st.button(f"Save {sec.title}", key=f"save_{sec.id}"): 
                    task.save_section_content(i, val)
                    persist_fn(task)
                    st.success("Saved")
                    st.rerun()

    # --- Stage 4: Revise ---
    elif stage == 3:
        col_back, _ = st.columns([1, 5])
        if col_back.button("◀ Back"):
            task.prev_stage()
            persist_fn(task)
            st.rerun()
            
        st.markdown("### 🔍 Review & Polish")
        
        col_editor, col_issues = st.columns([2, 1])
        
        with col_issues:
            if st.button("Run Revision Checks"):
                task.run_revision()
                persist_fn(task)
                st.rerun()
            
            if data.revision_passes:
                for issue in data.revision_passes:
                    color = "red" if issue.severity == "high" else "orange" if issue.severity == "medium" else "gray"
                    st.markdown(f":{color}[**{issue.issue_type}**]: {issue.description} ({issue.location})")
            else:
                st.info("Run checks to see feedback.")

        with col_editor:
            st.markdown("**Full Draft (Editable)**")
            full_text = task.get_full_draft()
            new_full = st.text_area("Full Essay", value=full_text, height=600)
            
            if st.button("Save Full Draft"):
                st.warning("Saving full draft updates the display but may desync individual sections.")

# --------- Reading UI Implementation ---------
def render_reading_ui(task: ReadingAssistantTask, persist_fn):
    st.markdown(f"### 📚 Reading Assistant")
    
    progress = task.get_progress()
    cols = st.columns(len(progress))
    colors = ["#74938B", "#6FCF97", "#F2C94C", "#5BA4E6"] 
    
    for i, p in enumerate(progress):
        with cols[i]:
            st.caption(f"{p['title']}")
            st.markdown(f"""
            <div style="background-color: #ddd; height: 10px; border-radius: 5px;">
                <div style="background-color: {colors[i%len(colors)]}; width: {p['percent']*100}%; height: 100%; border-radius: 5px;"></div>
            </div>
            <div style="font-size: 0.8em; text-align: right;">{p['read']}/{p['total']}</div>
            """, unsafe_allow_html=True)
    
    st.divider()
    
    chunk = task.get_current_chunk()
    if not chunk:
        st.info("No sources available.")
        return

    if chunk['is_finished']:
        st.success(f"Finished: {chunk['source_title']}")
        st.info("Please switch text.")
    else:
        st.markdown(f"**Current Source:** {chunk['source_title']} (Para {chunk['para_num']}/{chunk['total_paras']})")
        st.markdown(f"""
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 10px; border-left: 5px solid #6FCF97;">
            {chunk['text']}
        </div>
        """, unsafe_allow_html=True)

    st.markdown("<br>", unsafe_allow_html=True)

    c1, c2 = st.columns(2)
    if c1.button("Continue here ⬇️", use_container_width=True):
        task.advance(mode='continue')
        persist_fn(task)
        st.rerun()
        
    if c2.button("Switch text 🔀", use_container_width=True):
        task.advance(mode='switch')
        persist_fn(task)
        st.rerun()

if __name__ == "__main__":
    main()
