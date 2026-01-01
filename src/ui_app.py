import streamlit as st
import pandas as pd
from assistant_core import (
    TaskManager, EssayAssistantTask, ReadingAssistantTask, 
    configure_llm, is_llm_configured, infer_essay_parameters_from_text
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

# --------- Sidebar: Tasks & Settings ---------
def sidebar_ui():
    st.sidebar.title("🤖 Assistant")
    
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
    
    # Task List
    st.sidebar.subheader("Tasks")
    manager = st.session_state.task_manager
    tasks = manager.get_all_tasks()
    
    if not tasks:
        st.sidebar.info("No tasks yet.")
    
    for t in tasks:
        is_active = (st.session_state.current_task_id == t['id'])
        
        if is_active:
            c = st.sidebar.container()
            c.markdown(f"✅ **{t['type']}**")
            c.caption(f"ID: {t['id']}")
        else:
            col1, col2 = st.sidebar.columns([4, 1])
            if col1.button(f"{t['type']} \n {t['id'][:6]}...", key=t['id']):
                st.session_state.current_task_id = t['id']
                st.rerun()
            if col2.button("🗑️", key=f"del_{t['id']}"):
                manager.delete_task(t['id'])
                if is_active: st.session_state.current_task_id = None
                st.rerun()
        
        if is_active:
            st.sidebar.markdown("---")

# --------- Main UI ---------
def main():
    st.set_page_config(layout="wide", page_title="Essay & Reading Assistant")
    inject_custom_css()
    sidebar_ui()
    
    manager = st.session_state.task_manager
    
    # Top Tab Navigation
    tab_create, tab_work = st.tabs(["🆕 Create New Task", "📝 Work on Task"])
    
    # --- Create Tab ---
    with tab_create:
        type_ = st.radio("Task Type", ["Essay Task", "Reading Task"], horizontal=True)
        
        if type_ == "Essay Task":
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
                e_type = st.selectbox("Type", ["opinion", "analytical", "comparative"], 
                                    index=0 if defaults.get('essay_type')=='opinion' else 1)
                wc = st.number_input("Word Count", value=defaults.get('word_count', 500))
                if st.form_submit_button("Create Essay Task"):
                    t = manager.create_task("essay", {"topic": topic, "essay_type": e_type, "word_count": wc})
                    t.start()
                    st.session_state.current_task_id = t.id
                    st.success("Task Created!")
                    st.rerun()

        else:
            st.subheader("Create Reading Task")
            if 'num_texts' not in st.session_state: st.session_state.num_texts = 2
            
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
                    t = manager.create_task("reading", {"texts": valid_texts})
                    t.start()
                    st.session_state.current_task_id = t.id
                    st.rerun()

    # --- Work Tab ---
    with tab_work:
        if not st.session_state.current_task_id:
            st.info("Please select or create a task.")
            return

        task = manager.get_task(st.session_state.current_task_id)
        if not task:
            st.error("Task not found.")
            return

        if isinstance(task, EssayAssistantTask):
            render_essay_ui(task)
        elif isinstance(task, ReadingAssistantTask):
            render_reading_ui(task)

# --------- Essay UI Implementation ---------
def render_essay_ui(task: EssayAssistantTask):
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
            st.success("Thesis set!")
            st.rerun()
            
        if col2.button("Next stage ▶"): 
            try:
                task.next_stage()
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
        
        col_back, col_next = st.columns([1, 4])
        if col_back.button("◀ Back"):
            task.prev_stage()
            st.rerun()
            
        if col_next.button("Generate outline & go to Write stage"): 
            try:
                task.next_stage()
                st.rerun()
            except Exception as e:
                st.error(str(e))

    # --- Stage 3: Write ---
    elif stage == 2:
        st.write("Fill content for each section.")
        
        col_back, col_next = st.columns([1, 4])
        if col_back.button("◀ Back"):
            task.prev_stage()
            st.rerun()
        if col_next.button("All sections done Revise"): 
            try:
                task.next_stage()
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
                    st.success("Saved")
                    st.rerun()

    # --- Stage 4: Revise ---
    elif stage == 3:
        col_back, _ = st.columns([1, 5])
        if col_back.button("◀ Back"):
            task.prev_stage()
            st.rerun()
            
        st.markdown("### 🔍 Review & Polish")
        
        col_editor, col_issues = st.columns([2, 1])
        
        with col_issues:
            if st.button("Run Revision Checks"):
                task.run_revision()
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
def render_reading_ui(task: ReadingAssistantTask):
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
        st.rerun()
        
    if c2.button("Switch text 🔀", use_container_width=True):
        task.advance(mode='switch')
        st.rerun()

if __name__ == "__main__":
    main()