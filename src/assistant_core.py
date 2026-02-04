import re
import json
import os  
import uuid
import logging
from abc import ABC, abstractmethod
from datetime import datetime
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from enum import Enum

# ---------- Logging setup ----------
logger = logging.getLogger("assistant_core")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _formatter = logging.Formatter("[%(levelname)s] %(message)s")
    _handler.setFormatter(_formatter)
    logger.addHandler(_handler)

# ---------- xAI Integration (via OpenAI SDK) ----------

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

@dataclass
class LLMSettings:
    enabled: bool = False
    api_key: Optional[str] = None
    model: str = "grok-beta"
    base_url: str = "https://api.x.ai/v1"

_llm_settings = LLMSettings()

def configure_llm(
    enabled: bool,
    api_key: Optional[str] = None,
    model: str = "grok-beta",
) -> None:
    """
    Configure xAI settings. 
    """
    _llm_settings.enabled = enabled
    _llm_settings.api_key = api_key
    _llm_settings.model = model or "grok-beta"
    # Hardcoded to xAI
    _llm_settings.base_url = "https://api.x.ai/v1"

def is_llm_configured() -> bool:
    if not _llm_settings.enabled:
        return False
    if _llm_settings.api_key:
        return True
    # Check only xAI env var
    if os.getenv("XAI_API_KEY"):
        return True
    return False

def call_llm(
    prompt: str,
    *,
    system_prompt: Optional[str] = None,
    temperature: float = 0.7,
) -> Optional[str]:
    """
    Call xAI API.
    """
    if OpenAI is None:
        raise ImportError("The 'openai' library is missing. Run: pip install openai")

    if not is_llm_configured():
        raise ValueError("xAI is not configured. Check settings.")

    # Resolve Credentials
    api_key = _llm_settings.api_key or os.getenv("XAI_API_KEY")
    
    if not api_key:
        raise ValueError("No xAI API key found. Please enter it in the sidebar.")

    try:
        client = OpenAI(
            api_key=api_key,
            base_url=_llm_settings.base_url
        )

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        completion = client.chat.completions.create(
            model=_llm_settings.model,
            messages=messages,
            temperature=temperature,
        )
        
        return completion.choices[0].message.content

    except Exception as e:
        logger.error(f"xAI Call Failed: {e}")
        raise e

def infer_essay_parameters_from_text(description: str) -> Dict[str, Any]:
    """
    Uses xAI to extract parameters.
    """
    if not is_llm_configured():
        raise RuntimeError("xAI is not configured.")

    prompt = f"""
    Extract essay parameters from this description: "{description}"
    Return JSON only:
    {{
      "topic": "...",
      "essay_type": "one of [opinion, analytical, comparative, interpretive]",
      "word_count": 1000,
      "deadline": "YYYY-MM-DD"
    }}
    """
    # Using specific error handling for the auto-fill feature
    try:
        raw = call_llm(prompt, temperature=0.2)
        if raw.startswith("```"):
            raw = raw.strip().strip("`").replace("json", "")
        return json.loads(raw)
    except Exception as e:
        logger.error(f"Auto-fill failed: {e}")
        # Raise it so the UI shows the error instead of silently failing
        raise e

# ========== BASE TASK SYSTEM (Unchanged) ==========

class TaskStatus(Enum):
    INITIALIZED = "initialized"
    ACTIVE = "active"
    COMPLETED = "completed"

class Task(ABC):
    def __init__(self, params: Dict[str, Any], task_id: Optional[str] = None, status: TaskStatus = TaskStatus.INITIALIZED):
        self.id = task_id or f"task_{uuid.uuid4().hex[:9]}"
        self.type = self.__class__.__name__
        self.created_at = datetime.now()
        self.status = status
        self.params = params or {}

    @abstractmethod
    def start(self) -> Dict[str, Any]: pass

# ========== ESSAY DATA MODELS ==========

@dataclass
class OutlineSection:
    title: str
    word_count: int
    guiding_question: str = ""
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "word_count": self.word_count,
            "guiding_question": self.guiding_question,
            "id": self.id,
        }

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "OutlineSection":
        return OutlineSection(
            title=data.get("title", ""),
            word_count=int(data.get("word_count", 0)),
            guiding_question=data.get("guiding_question", ""),
            id=data.get("id") or str(uuid.uuid4())[:8],
        )

@dataclass
class Outline:
    sections: List[OutlineSection] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {"sections": [s.to_dict() for s in self.sections]}

    @staticmethod
    def from_dict(data: Optional[Dict[str, Any]]) -> Optional["Outline"]:
        if not data:
            return None
        sections = [OutlineSection.from_dict(s) for s in data.get("sections", [])]
        return Outline(sections=sections)

@dataclass
class EssaySection:
    title: str
    target_words: int
    guiding_question: str = ""
    content: str = ""
    actual_words: int = 0
    completed: bool = False
    tree_prompts: Dict[str, str] = field(default_factory=dict)
    id: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "target_words": self.target_words,
            "guiding_question": self.guiding_question,
            "content": self.content,
            "actual_words": self.actual_words,
            "completed": self.completed,
            "tree_prompts": self.tree_prompts,
            "id": self.id,
        }

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "EssaySection":
        return EssaySection(
            title=data.get("title", ""),
            target_words=int(data.get("target_words", 0)),
            guiding_question=data.get("guiding_question", ""),
            content=data.get("content", ""),
            actual_words=int(data.get("actual_words", 0)),
            completed=bool(data.get("completed", False)),
            tree_prompts=data.get("tree_prompts", {}) or {},
            id=data.get("id", ""),
        )

@dataclass
class RevisionIssue:
    issue_type: str
    description: str
    location: str
    severity: str = "medium"
    suggestion: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "issue_type": self.issue_type,
            "description": self.description,
            "location": self.location,
            "severity": self.severity,
            "suggestion": self.suggestion,
        }

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "RevisionIssue":
        return RevisionIssue(
            issue_type=data.get("issue_type", ""),
            description=data.get("description", ""),
            location=data.get("location", ""),
            severity=data.get("severity", "medium"),
            suggestion=data.get("suggestion"),
        )

@dataclass
class EssayData:
    topic: str = ""
    essay_type: str = ""
    word_count: int = 0
    deadline: Optional[datetime] = None
    thesis: str = ""
    thesis_suggestions: List[str] = field(default_factory=list)
    outline: Optional[Outline] = None
    sections: List[EssaySection] = field(default_factory=list)
    revision_passes: List[RevisionIssue] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "topic": self.topic,
            "essay_type": self.essay_type,
            "word_count": self.word_count,
            "deadline": self.deadline.isoformat() if self.deadline else None,
            "thesis": self.thesis,
            "thesis_suggestions": list(self.thesis_suggestions),
            "outline": self.outline.to_dict() if self.outline else None,
            "sections": [s.to_dict() for s in self.sections],
            "revision_passes": [i.to_dict() for i in self.revision_passes],
        }

    @staticmethod
    def from_dict(data: Optional[Dict[str, Any]]) -> "EssayData":
        data = data or {}
        deadline = data.get("deadline")
        parsed_deadline = datetime.fromisoformat(deadline) if deadline else None
        return EssayData(
            topic=data.get("topic", ""),
            essay_type=data.get("essay_type", ""),
            word_count=int(data.get("word_count", 0)),
            deadline=parsed_deadline,
            thesis=data.get("thesis", ""),
            thesis_suggestions=data.get("thesis_suggestions", []) or [],
            outline=Outline.from_dict(data.get("outline")),
            sections=[EssaySection.from_dict(s) for s in data.get("sections", [])],
            revision_passes=[RevisionIssue.from_dict(i) for i in data.get("revision_passes", [])],
        )

# ========== ESSAY STAGES ==========

class EssayAssistantTask(Task):
    def __init__(self, params: Dict[str, Any], task_id: Optional[str] = None, status: TaskStatus = TaskStatus.INITIALIZED):
        super().__init__(params, task_id=task_id, status=status)
        self.essay_data = EssayData()
        self.current_stage_idx = 0
        self.stage_names = ["Pick Ideas", "Organize", "Write", "Revise"]

    def start(self):
        self.essay_data.topic = self.params.get("topic", "")
        self.essay_data.essay_type = self.params.get("essay_type", "opinion")
        self.essay_data.word_count = int(self.params.get("word_count", 500))
        self.status = TaskStatus.ACTIVE
        return {"message": "Task started", "stage": self.stage_names[0]}

    def next_stage(self):
        if self.current_stage_idx == 0:
            if not self.essay_data.thesis:
                raise ValueError("Please set a thesis first.")
            if not self.essay_data.outline:
                self.generate_initial_outline()
        elif self.current_stage_idx == 1:
            if not self.essay_data.outline or not self.essay_data.outline.sections:
                raise ValueError("Outline cannot be empty.")
            self.sync_outline_to_sections()

        if self.current_stage_idx < len(self.stage_names) - 1:
            self.current_stage_idx += 1
            return {"message": f"Moved to {self.stage_names[self.current_stage_idx]}"}
        return {"message": "Already at final stage"}

    def prev_stage(self):
        if self.current_stage_idx > 0:
            self.current_stage_idx -= 1
            return {"message": f"Moved back to {self.stage_names[self.current_stage_idx]}"}
        return {"message": "Already at first stage"}

    def set_thesis(self, text: str):
        self.essay_data.thesis = text
        return {"message": "Thesis saved"}

    def generate_thesis_suggestions(self):
        if not is_llm_configured():
            raise ValueError("xAI not configured")
        
        prompt = f"Generate 3 distinct, arguable thesis statements for an {self.essay_data.essay_type} essay on: {self.essay_data.topic}. Return only the statements as a list."
        res = call_llm(prompt)
        if res:
            self.essay_data.thesis_suggestions = [
                line.strip().lstrip("1234567890.-*• ") 
                for line in res.split('\n') 
                if line.strip()
            ][:3]

    def generate_initial_outline(self):
        wc = self.essay_data.word_count
        sections = [
            OutlineSection("Introduction", int(wc * 0.15), "Hook and Thesis"),
            OutlineSection("Body Paragraph 1", int(wc * 0.25), "First Argument"),
            OutlineSection("Body Paragraph 2", int(wc * 0.25), "Second Argument"),
            OutlineSection("Body Paragraph 3", int(wc * 0.20), "Third Argument"),
            OutlineSection("Conclusion", int(wc * 0.15), "Summary and Final Thought")
        ]
        self.essay_data.outline = Outline(sections)

    def update_outline(self, new_sections_data: List[Dict]):
        new_sections = []
        for s in new_sections_data:
            new_sections.append(OutlineSection(
                title=s['title'],
                word_count=int(s['word_count']),
                guiding_question=s.get('guiding_question', ''),
                id=s.get('id') or str(uuid.uuid4())[:8]
            ))
        self.essay_data.outline = Outline(new_sections)

    def sync_outline_to_sections(self):
        current_map = {s.id: s for s in self.essay_data.sections}
        new_sections = []
        for out_sec in self.essay_data.outline.sections:
            existing = current_map.get(out_sec.id)
            if existing:
                existing.title = out_sec.title
                existing.target_words = out_sec.word_count
                existing.guiding_question = out_sec.guiding_question
                new_sections.append(existing)
            else:
                new_sections.append(EssaySection(
                    title=out_sec.title,
                    target_words=out_sec.word_count,
                    guiding_question=out_sec.guiding_question,
                    id=out_sec.id,
                    tree_prompts=self._get_tree_defaults(out_sec.title)
                ))
        self.essay_data.sections = new_sections

    def _get_tree_defaults(self, title):
        if "Intro" in title:
            return {"T": "Topic/Hook", "R": "Reasons preview", "E1": "Context", "E2": "Thesis"}
        elif "Conclu" in title:
            return {"T": "Restate Thesis", "R": "Recap Reasons", "E1": "Significance", "E2": "Final Thought"}
        else:
            return {"T": "Topic Sentence", "R": "Reasons/Evidence", "E1": "Explanation", "E2": "Transition"}

    def save_section_content(self, idx: int, content: str):
        if 0 <= idx < len(self.essay_data.sections):
            self.essay_data.sections[idx].content = content
            self.essay_data.sections[idx].actual_words = len(content.split())
            self.essay_data.sections[idx].completed = True

    def run_revision(self):
        issues = []
        total_words = sum(s.actual_words for s in self.essay_data.sections)
        if abs(total_words - self.essay_data.word_count) > self.essay_data.word_count * 0.1:
            issues.append(RevisionIssue("word_count", f"Total words ({total_words}) deviates from target ({self.essay_data.word_count})", "Overall", "high"))
        for s in self.essay_data.sections:
            if s.actual_words < s.target_words * 0.5:
                 issues.append(RevisionIssue("word_count", f"Section '{s.title}' is too short", s.title, "medium"))
        self.essay_data.revision_passes = issues

    def get_full_draft(self) -> str:
        return "\n\n".join([s.content for s in self.essay_data.sections])

    def to_state(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "task_type": "essay",
            "params": self.params,
            "status": self.status.value,
            "current_stage_idx": self.current_stage_idx,
            "essay_data": self.essay_data.to_dict(),
        }

    @staticmethod
    def from_state(state: Dict[str, Any]) -> "EssayAssistantTask":
        status = TaskStatus(state.get("status", TaskStatus.INITIALIZED.value))
        task = EssayAssistantTask(
            state.get("params", {}),
            task_id=state.get("id"),
            status=status,
        )
        task.current_stage_idx = int(state.get("current_stage_idx", 0))
        task.essay_data = EssayData.from_dict(state.get("essay_data", {}))
        return task

# ========== READING ASSISTANT TASK ==========

@dataclass
class ReadingSource:
    id: str
    title: str
    paragraphs: List[str]
    current_index: int = 0 

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "paragraphs": list(self.paragraphs),
            "current_index": self.current_index,
        }

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "ReadingSource":
        return ReadingSource(
            id=data.get("id", ""),
            title=data.get("title", ""),
            paragraphs=data.get("paragraphs", []) or [],
            current_index=int(data.get("current_index", 0)),
        )

class ReadingAssistantTask(Task):
    def __init__(self, params: Dict[str, Any], task_id: Optional[str] = None, status: TaskStatus = TaskStatus.INITIALIZED):
        super().__init__(params, task_id=task_id, status=status)
        self.sources: List[ReadingSource] = []
        self.current_source_idx: Optional[int] = None

    def start(self):
        raw_texts = self.params.get("texts", [])
        for i, t in enumerate(raw_texts):
            text_content = t.get("text", "") if isinstance(t, dict) else t
            title = t.get("title", f"Text {i+1}") if isinstance(t, dict) else f"Text {i+1}"
            paras = [p.strip() for p in text_content.split('\n\n') if p.strip()]
            self.sources.append(ReadingSource(f"src_{i}", title, paras))
        
        if self.sources:
            self.current_source_idx = 0
            self.status = TaskStatus.ACTIVE
        return {"message": "Reading started"}

    def get_current_chunk(self):
        if self.current_source_idx is None: return None
        src = self.sources[self.current_source_idx]
        if src.current_index < len(src.paragraphs):
            return {
                "source_title": src.title,
                "text": src.paragraphs[src.current_index],
                "para_num": src.current_index + 1,
                "total_paras": len(src.paragraphs),
                "is_finished": False
            }
        else:
            return {"source_title": src.title, "text": "End of text.", "is_finished": True}

    def advance(self, mode: str):
        if self.current_source_idx is None: return
        current_src = self.sources[self.current_source_idx]
        
        if current_src.current_index < len(current_src.paragraphs):
            current_src.current_index += 1

        if mode == 'switch':
            start = self.current_source_idx
            for i in range(1, len(self.sources) + 1):
                idx = (start + i) % len(self.sources)
                if self.sources[idx].current_index < len(self.sources[idx].paragraphs):
                    self.current_source_idx = idx
                    return
        elif mode == 'continue':
            if current_src.current_index >= len(current_src.paragraphs):
                self.advance(mode='switch')

    def get_progress(self):
        return [
            {
                "title": s.title,
                "read": s.current_index,
                "total": len(s.paragraphs),
                "percent": s.current_index / len(s.paragraphs) if s.paragraphs else 0
            }
            for s in self.sources
        ]

    def to_state(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "task_type": "reading",
            "params": self.params,
            "status": self.status.value,
            "current_source_idx": self.current_source_idx,
            "sources": [s.to_dict() for s in self.sources],
        }

    @staticmethod
    def from_state(state: Dict[str, Any]) -> "ReadingAssistantTask":
        status = TaskStatus(state.get("status", TaskStatus.INITIALIZED.value))
        task = ReadingAssistantTask(
            state.get("params", {}),
            task_id=state.get("id"),
            status=status,
        )
        task.current_source_idx = state.get("current_source_idx")
        task.sources = [ReadingSource.from_dict(s) for s in state.get("sources", [])]
        return task


def task_from_state(state: Dict[str, Any]) -> Task:
    task_type = state.get("task_type")
    if task_type == "essay":
        return EssayAssistantTask.from_state(state)
    if task_type == "reading":
        return ReadingAssistantTask.from_state(state)
    raise ValueError(f"Unknown task_type: {task_type}")

# ========== TASK MANAGER ==========

class TaskManager:
    def __init__(self):
        self.tasks: Dict[str, Task] = {}

    def create_task(self, type_: str, params: Dict) -> Task:
        if type_ == "essay":
            t = EssayAssistantTask(params)
        else:
            t = ReadingAssistantTask(params)
        self.tasks[t.id] = t
        return t

    def get_task(self, id_: str) -> Task:
        return self.tasks.get(id_)

    def get_all_tasks(self):
        return [{"id": t.id, "type": t.type, "status": t.status.value} for t in self.tasks.values()]
    
    def delete_task(self, id_: str):
        if id_ in self.tasks:
            del self.tasks[id_]
