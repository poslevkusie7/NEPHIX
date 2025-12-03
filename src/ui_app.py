import streamlit as st
from datetime import datetime, timedelta
from typing import List, Dict, Any

from assistant_core import (
    TaskManager,
    EssayAssistantTask,
    ReadingAssistantTask,
    TaskStatus,
    configure_llm,
    is_llm_configured,
    infer_essay_parameters_from_text
)


# --------- Session state setup ---------

if "task_manager" not in st.session_state:
    st.session_state.task_manager = TaskManager()

if "current_task_id" not in st.session_state:
    st.session_state.current_task_id = None

# --------- LLM configuration (sidebar) ---------


def setup_llm_from_sidebar() -> None:
    """
    Expose LLM configuration controls in the sidebar.

    Values entered here are forwarded to `assistant_core.configure_llm`,
    which `EssayAssistantTask` uses for model calls.
    """
    with st.sidebar:
        st.subheader("🔌 LLM settings")
        use_llm = st.checkbox(
            "Enable AI features (LLM)",
            value=False,
            help="Turn this on to use an external LLM for thesis suggestions, etc.",
        )
        api_key = st.text_input(
            "API key",
            type="password",
            help=(
                "API key for your LLM provider (e.g., OpenAI). "
                "If left blank, the environment variable OPENAI_API_KEY is used."
            ),
        )
        model = st.text_input(
            "Model name",
            value="gpt-4o-mini",
            help="Model identifier, e.g. 'gpt-4o-mini'.",
        )
        base_url = st.text_input(
            "Base URL (optional)",
            value="",
            help=(
                "For self-hosted / Azure / proxy endpoints that speak the "
                "OpenAI-compatible Chat Completions API."
            ),
        )

    configure_llm(
        enabled=use_llm,
        api_key=api_key.strip() or None,
        model=model.strip() or "gpt-4o-mini",
        base_url=base_url.strip() or None,
    )

# --------- Helper: render common stage UI lines ---------

def render_ui_lines(payload: Dict[str, Any]) -> None:
    """Render ui_lines and basic stage/context info if present."""
    stage = payload.get("stage")
    context = payload.get("context")
    ui_lines = payload.get("ui_lines")

    if stage:
        st.subheader(f"Stage {stage.get('number', '?')}: {stage.get('name', '')}")

    if context:
        topic = context.get("topic")
        essay_type = context.get("essay_type")
        if topic:
            st.write(f"**Topic:** {topic}")
        if essay_type:
            st.write(f"**Essay type:** {essay_type}")

    if ui_lines:
        for line in ui_lines:
            if line.strip():
                st.write(line)
            else:
                st.write("")


# --------- Essay UI: create task ---------

def create_essay_task_ui():
    st.header("📄 Essay Assistant")

    st.markdown("#### Option A: Paste assignment text (Advanced, uses LLM)")
    assignment_text = st.text_area(
        "Assignment description (optional)",
        help=(
            "Paste the full prompt here, e.g. "
            '"Write a 1000-word opinion essay on Martin Eden, due next Friday."'
        ),
    )
    if assignment_text and is_llm_configured():
        if st.button("✨ Extract topic, type, word count, deadline"):
            try:
                parsed = infer_essay_parameters_from_text(assignment_text)
                st.success("Extracted parameters (you can copy them into the form below):")
                st.write(f"**Topic:** {parsed['topic'] or '—'}")
                st.write(f"**Essay type:** {parsed['essay_type'] or '—'}")
                st.write(f"**Word count:** {parsed['word_count'] or '—'}")
                st.write(f"**Deadline (ISO):** {parsed['deadline'] or '—'}")
                with st.expander("Raw LLM JSON", expanded=False):
                    st.json(parsed["raw"])
            except Exception as e:
                st.error(f"Extraction failed: {e}")

    st.markdown("---")
    st.markdown("#### Option B: Enter parameters manually")
    
    with st.form("essay_form"):
        topic = st.text_input(
            "Topic",
            "The impact of social media on modern communication"
        )
        essay_type = st.selectbox(
            "Essay type",
            ["opinion", "analytical", "comparative", "interpretive"],
            index=0,
        )
        word_count = st.number_input(
            "Target word count",
            min_value=100,
            max_value=5000,
            value=1000,
            step=50,
        )
        days = st.number_input(
            "Days until deadline",
            min_value=1,
            value=5,
            step=1,
        )
        submitted = st.form_submit_button("Create Essay Task")

    if submitted:
        deadline = (datetime.now() + timedelta(days=int(days))).isoformat()
        manager: TaskManager = st.session_state.task_manager
        task = manager.create_task("essay", {
            "topic": topic,
            "essay_type": essay_type,
            "word_count": int(word_count),
            "deadline": deadline,
        })
        st.session_state.current_task_id = task.id
        result = manager.start_task(task.id)

        st.success(f"Created essay task `{task.id}`")

        # Show initial stage info from backend
        render_ui_lines(result)
        with st.expander("Raw response (debug)", expanded=False):
            st.json(result)

        # 🔽 Immediately show the specialised "solve" UI for this task
        st.markdown("---")
        st.info("Continue working on this essay below:")
        essay_stage_controls()  # uses current_task_id from session


def essay_stage_controls():
    manager: TaskManager = st.session_state.task_manager
    task_id = st.session_state.current_task_id
    task = manager.get_task(task_id)
    assert isinstance(task, EssayAssistantTask)

    status = task.get_essay_status()
    st.subheader("Essay Status")
    st.json(status)

    stage_name = status["stage_name"]
    current_stage = status["current_stage"]
    st.markdown(f"### Current Stage: {current_stage} – {stage_name}")

    # Stage 1: thesis
    if current_stage == 1:
        thesis = st.text_area(
            "Enter thesis (1–2 sentences)",
            value=task.essay_data.thesis or "",
        )

        # Optional LLM support for SRSD Stage 1: Pick Ideas
        if is_llm_configured():
            if st.button("💡 Suggest thesis with AI"):
                try:
                    res = task.generate_thesis_suggestions()
                    st.success(res.get("message", "Got suggestions from the model."))
                    st.info(
                        "Copy one of the options below into the box above, "
                        "then click 'Set thesis'."
                    )
                    for i, cand in enumerate(res.get("candidates", []), start=1):
                        st.markdown(f"**Option {i}:** {cand}")
                except Exception as e:
                    st.error(f"LLM error: {e}")

        col1, col2 = st.columns(2)
        if col1.button("Set thesis"):
            try:
                res = task.set_thesis(thesis)
                st.success(res["message"])
                render_ui_lines(res)
            except Exception as e:
                st.error(str(e))
        if col2.button("Next stage ▶"):
            try:
                res = manager.advance_task(task_id)
                st.success("Moved to next stage")
                render_ui_lines(res)
                with st.expander("Raw response (debug)", expanded=False):
                    st.json(res)
            except Exception as e:
                st.error(str(e))

    # Stage 2: Organize
    elif current_stage == 2:
        st.write("Outline will be generated from topic + word count.")
        if st.button("Generate outline & go to Write stage ▶"):
            try:
                res2 = manager.advance_task(task_id)  # 2 -> 3
                st.success("Outline generated. Moved to Write stage.")
                render_ui_lines(res2)
                with st.expander("Raw response (debug)", expanded=False):
                    st.json(res2)
            except Exception as e:
                st.error(str(e))

    # Stage 3: Write
    elif current_stage == 3:
        st.write("Fill content for each section.")

        sections = task.essay_data.sections
        if not sections:
            st.info("No sections initialized yet. Try advancing to this stage again.")
            return

        for idx, sec in enumerate(sections):
            with st.expander(
                f"{idx + 1}. {sec.title} (target {sec.target_words} words)",
                expanded=False,
            ):
                if sec.guiding_question:
                    st.caption(sec.guiding_question)
                if sec.tree_prompts:
                    st.markdown("**TREE prompts:**")
                    for key, text in sec.tree_prompts.items():
                        st.write(f"- **{key}**: {text}")

                default_text = sec.content or ""
                new_text = st.text_area(
                    f"Content for {sec.title}",
                    value=default_text,
                    key=f"section_{idx}",
                    height=180,
                )
                if st.button(f"Save section {idx + 1}", key=f"save_{idx}"):
                    try:
                        res = task.add_section_content(idx, new_text)
                        st.success(
                            f"Saved. Section completed: {res['completed']}. "
                            f"All sections done: {res['total_completed']}"
                        )
                    except Exception as e:
                        st.error(str(e))

        if st.button("All sections done → Revise ▶"):
            try:
                res = manager.advance_task(task_id)  # 3 -> 4
                st.success("Moved to Revise stage.")
                render_ui_lines(res)
                with st.expander("Raw response (debug)", expanded=False):
                    st.json(res)
            except Exception as e:
                st.error(str(e))

    # Stage 4: Revise
    elif current_stage == 4:
        st.write("Run revision and see issues.")

        if st.button("Run revision passes"):
            try:
                revise_stage = task.stages[3]
                res = revise_stage.execute(task.essay_data)
                st.success("Revision done.")
                render_ui_lines(res)
                with st.expander("Raw response (debug)", expanded=False):
                    st.json(res)
            except Exception as e:
                st.error(str(e))

        issues = task.essay_data.revision_passes
        if issues:
            st.subheader("Revision issues")
            for issue in issues:
                st.markdown(
                    f"- **[{issue.severity}]** `{issue.issue_type}` at *{issue.location}*: "
                    f"{issue.description}"
                )
        else:
            st.info("No issues recorded yet.")

        if st.button("Mark essay as completed ✅"):
            task.status = TaskStatus.COMPLETED
            st.success("Essay task marked as completed.")


# --------- Reading UI: create task ---------

def create_reading_task_ui():
    st.header("📚 Reading Assistant")

    st.write("Paste multiple texts and read them interleaved, chunk by chunk.")

    n = st.number_input(
        "How many texts?",
        min_value=1,
        max_value=10,
        value=2,
        step=1,
    )
    texts: List[Dict[str, Any]] = []
    for i in range(int(n)):
        with st.expander(f"Text {i + 1}", expanded=(i == 0)):
            title = st.text_input(
                f"Title for text {i + 1}",
                value=f"Text {i + 1}",
                key=f"title_{i}",
            )
            content = st.text_area(
                f"Content for text {i + 1}",
                height=200,
                key=f"text_{i}",
            )
            texts.append({
                "id": f"text_{i + 1}",
                "title": title,
                "text": content,
            })

    seed = st.text_input("Seed (optional, for reproducible order)", value="")
    shuffle_each = st.checkbox("Shuffle each round", value=True)

    if st.button("Create Reading Task"):
        manager: TaskManager = st.session_state.task_manager
        seed_val = None
        if seed:
            seed_val = int(seed) if seed.isdigit() else seed

        task = manager.create_task("reading", {
            "texts": texts,
            "seed": seed_val,
            "shuffle_each_round": shuffle_each,
        })

        st.session_state.current_task_id = task.id
        preview = manager.start_task(task.id)
        st.success(f"Created reading task `{task.id}`")

        render_ui_lines(preview)
        with st.expander("Raw response (debug)", expanded=False):
            st.json(preview)

        # 🔽 Immediately show specialised "solve" UI for reading
        st.markdown("---")
        st.info("Start reading with interleaved chunks below:")
        reading_controls()


def reading_controls():
    manager: TaskManager = st.session_state.task_manager
    task_id = st.session_state.current_task_id
    task = manager.get_task(task_id)
    assert isinstance(task, ReadingAssistantTask)

    status = task.get_reading_status()
    st.subheader("Reading Status")
    st.json(status)

    if status["remaining"] <= 0:
        st.info("No more chunks. Task is completed.")
        return

    if st.button("Get next chunk ▶"):
        out = manager.advance_task(task_id)
        if out.get("completed"):
            st.success("All chunks delivered.")
        else:
            c = out["chunk"]
            st.markdown(
                f"**Chunk {out['chunk_number']} / {out['total_chunks']}**  \n"
                f"Source: **{c['source_title']}**  "
                f"(paragraph {c['paragraph_index']} / {c['total_paragraphs_for_source']})"
            )
            st.write(c["text"])
            st.caption(f"Remaining chunks: {out['remaining']}")


# --------- Task list + main layout ---------

def main():
    st.set_page_config(
        page_title="Essay & Reading Assistant",
        layout="wide",
    )
    st.title("📝 Essay & 📚 Reading Assistant – Test UI")
    
    setup_llm_from_sidebar()

    manager: TaskManager = st.session_state.task_manager

    col_task_list, col_main = st.columns([1, 3])

    # Left: task list
    with col_task_list:
        st.subheader("Tasks")
        tasks = manager.get_all_tasks()
        if tasks:
            for t in tasks:
                label = f"{t['type']} – {t['id']} ({t['status']})"
                if st.button(label, key=t["id"]):
                    st.session_state.current_task_id = t["id"]
        else:
            st.info("No tasks yet.")

        if st.session_state.current_task_id:
            st.write(f"**Selected task:** `{st.session_state.current_task_id}`")
            if st.button("Delete selected task 🗑"):
                manager.delete_task(st.session_state.current_task_id)
                st.session_state.current_task_id = None
                st.success("Deleted task.")

    # Right: main area
    with col_main:
        mode = st.radio(
            "What do you want to do?",
            ["Create Essay Task", "Create Reading Task", "Work on existing task"],
        )

        if mode == "Create Essay Task":
            create_essay_task_ui()
        elif mode == "Create Reading Task":
            create_reading_task_ui()
        else:
            if not st.session_state.current_task_id:
                st.info("Select a task on the left or create a new one.")
            else:
                task = manager.get_task(st.session_state.current_task_id)
                if isinstance(task, EssayAssistantTask):
                    essay_stage_controls()
                elif isinstance(task, ReadingAssistantTask):
                    reading_controls()
                else:
                    st.warning("Unknown task type.")


if __name__ == "__main__":
    main()