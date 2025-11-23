#!/usr/bin/env python3

import re
import json
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from enum import Enum

import uuid
import random
import logging

# ---------- Logging setup ----------
logger = logging.getLogger("assistant_core")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _formatter = logging.Formatter("[%(levelname)s] %(message)s")
    _handler.setFormatter(_formatter)
    logger.addHandler(_handler)


# ========== BASE TASK SYSTEM ==========

class TaskStatus(Enum):
    INITIALIZED = "initialized"
    ACTIVE = "active"
    COMPLETED = "completed"
    FAILED = "failed"


class Task(ABC):
    """Abstract base class for all task types"""

    def __init__(self, params: Dict[str, Any]):
        self.id = self._generate_id()
        self.type = self.__class__.__name__
        self.created_at = datetime.now()
        self.status = TaskStatus.INITIALIZED
        self.current_stage = 0
        self.params = params or {}

    def _generate_id(self) -> str:
        return f"task_{uuid.uuid4().hex[:9]}"

    @abstractmethod
    def validate_params(self) -> bool:
        """Validate input parameters"""
        pass

    @abstractmethod
    def start(self) -> Dict[str, Any]:
        """Start the task execution"""
        pass

    def get_current_stage(self) -> int:
        return self.current_stage

    def save(self) -> Dict[str, Any]:
        """Serialize task state"""
        return {
            "id": self.id,
            "type": self.type,
            "status": self.status.value,
            "current_stage": self.current_stage,
            "params": self.params,
            "created_at": self.created_at.isoformat(),
        }


class TaskFactory:
    """Factory for creating different task types"""

    @staticmethod
    def create_task(task_type: str, params: Dict[str, Any]) -> Task:
        if task_type == "essay":
            return EssayAssistantTask(params)
        elif task_type == "reading":
            return ReadingAssistantTask(params)
        else:
            raise ValueError(f"Unknown task type: {task_type}")


# ========== ESSAY DATA MODELS ==========

@dataclass
class EssayData:
    """Core essay data structure"""

    topic: str = ""
    essay_type: str = ""
    word_count: int = 0
    deadline: Optional[datetime] = None
    thesis: str = ""
    outline: Optional["Outline"] = None
    sections: List["EssaySection"] = field(default_factory=list)
    revision_passes: List["RevisionIssue"] = field(default_factory=list)
    timeline: Optional[Dict[str, Any]] = None


@dataclass
class OutlineSection:
    """Individual section in the outline"""

    title: str
    word_count: int
    guiding_question: str = ""
    content: str = ""
    completed: bool = False


@dataclass
class Outline:
    """Essay outline with word distribution"""

    sections: List[OutlineSection] = field(default_factory=list)

    @property
    def total_words(self) -> int:
        return sum(section.word_count for section in self.sections)

    def add_section(self, section: OutlineSection):
        self.sections.append(section)

    def get_word_distribution(self) -> List[Dict[str, Any]]:
        total = self.total_words or 1
        return [
            {
                "title": section.title,
                "word_count": section.word_count,
                "percentage": round((section.word_count / total) * 100, 1),
            }
            for section in self.sections
        ]


@dataclass
class EssaySection:
    """Individual essay section with content"""

    title: str
    target_words: int
    guiding_question: str = ""
    content: str = ""
    actual_words: int = 0
    completed: bool = False
    tree_prompts: Dict[str, str] = field(default_factory=dict)


@dataclass
class RevisionIssue:
    """Issue found during revision"""

    issue_type: str
    description: str
    location: str
    severity: str = "medium"  # high, medium, low
    resolved: bool = False


# ========== ESSAY STAGES ==========

class EssayStage(ABC):
    """Abstract base class for essay stages"""

    def __init__(self, name: str, stage_number: int):
        self.name = name
        self.stage_number = stage_number
        self.completed = False
        self.issues: List[RevisionIssue] = []

    @abstractmethod
    def execute(self, essay_data: EssayData) -> Dict[str, Any]:
        """Execute the stage"""
        pass

    @abstractmethod
    def validate(self, essay_data: EssayData) -> bool:
        """Validate stage completion"""
        pass


class PickIdeasStage(EssayStage):
    """Stage 1: Pick Ideas - Manual thesis entry"""

    def __init__(self):
        super().__init__("Pick Ideas", 1)

    def execute(self, essay_data: EssayData) -> Dict[str, Any]:
        """
        Prepare the Pick Ideas stage.
        Returns UI lines and logs key info.
        """
        ui_lines = [
            "=== STAGE 1: PICK IDEAS ===",
            f"Topic: {essay_data.topic}",
            f"Essay Type: {essay_data.essay_type}",
            "",
            "Please provide your thesis statement (1–2 sentences).",
            "Your thesis should be:",
            "- Debatable (not a fact)",
            "- Relevant to the topic",
            "- Scalable to target word count",
        ]

        logger.info("Stage 1 (Pick Ideas) started")
        logger.info("Topic: %s", essay_data.topic)
        logger.info("Essay type: %s", essay_data.essay_type)

        return {
            "ready": False,  # waiting for user input
            "message": "Thesis input required",
            "stage": {"name": self.name, "number": self.stage_number},
            "context": {
                "topic": essay_data.topic,
                "essay_type": essay_data.essay_type,
            },
            "ui_lines": ui_lines,
        }

    def set_thesis(self, essay_data: EssayData, thesis: str) -> Dict[str, Any]:
        logger.info("Attempting to set thesis")
        if not self._validate_thesis(thesis):
            logger.warning("Invalid thesis provided: %r", thesis)
            raise ValueError("Invalid thesis statement")

        essay_data.thesis = thesis
        self.completed = True

        logger.info("Thesis confirmed and stage 1 completed")

        ui_lines = [
            "Thesis confirmed.",
            f'"{thesis}"',
        ]

        return {
            "ready": True,
            "message": "Thesis set successfully",
            "thesis": thesis,
            "stage": {"name": self.name, "number": self.stage_number},
            "ui_lines": ui_lines,
        }

    def _validate_thesis(self, thesis: str) -> bool:
        if not thesis or len(thesis.strip()) < 10:
            return False

        sentences = [s.strip() for s in thesis.split(".") if s.strip()]
        return 1 <= len(sentences) <= 2

    def validate(self, essay_data: EssayData) -> bool:
        return bool(essay_data.thesis)


class OrganizeStage(EssayStage):
    """Stage 2: Organize - Generate outline with word distribution"""

    def validate_custom_outline(self, essay_data: EssayData) -> List[str]:
        errors = []
        outline = essay_data.outline
        if not outline or not outline.sections:
            errors.append("Outline has no sections.")
            return errors
        titles = [s.title.strip().lower() for s in outline.sections]
        if "introduction" not in titles:
            errors.append('Missing "Introduction" section.')
        if "conclusion" not in titles:
            errors.append('Missing "Conclusion" section.')
        total = sum(s.word_count for s in outline.sections)
        target = essay_data.word_count
        if target:
            deviation = abs(total - target) / target
            if deviation > 0.1:
                errors.append(
                    f"Total word count deviates by {round(deviation * 100)}% ({total}/{target})."
                )
        for s in outline.sections:
            if s.word_count <= 0:
                errors.append(f'Section "{s.title}" must have a positive word count.')
        return errors

    def __init__(self):
        super().__init__("Organize", 2)

    def execute(self, essay_data: EssayData) -> Dict[str, Any]:
        logger.info("Stage 2 (Organize) started")
        logger.info('Generating outline for thesis: "%s"', essay_data.thesis)

        outline = self._generate_outline(essay_data)
        essay_data.outline = outline
        self.completed = True

        ui_lines = [
            "=== STAGE 2: ORGANIZE (OUTLINE) ===",
            f'Creating outline for: "{essay_data.thesis}"',
            "",
            "📋 Generated Outline:",
        ]
        for i, section in enumerate(outline.sections, 1):
            ui_lines.append(f"{i}. {section.title} ({section.word_count} words)")
            if section.guiding_question:
                ui_lines.append(f"   → {section.guiding_question}")

        logger.info("Outline generated with %d sections", len(outline.sections))

        return {
            "ready": True,
            "message": "Outline generated successfully",
            "stage": {"name": self.name, "number": self.stage_number},
            "data": outline,
            "ui_lines": ui_lines,
        }

    def _generate_outline(self, essay_data: EssayData) -> Outline:
        total_words = essay_data.word_count
        sections: List[OutlineSection] = []

        # Word distribution (MVP percentages)
        intro_words = round(total_words * 0.125)  # 12.5%
        conclusion_words = round(total_words * 0.125)  # 12.5%
        body_words = total_words - intro_words - conclusion_words  # 75%

        # Determine number of body paragraphs
        body_para_count = self._calculate_body_paragraphs(total_words)
        words_per_body_para = round(body_words / max(1, body_para_count))

        # Create sections
        sections.append(
            OutlineSection(
                "Introduction",
                intro_words,
                "How will you introduce the topic and present your thesis?",
            )
        )

        for i in range(1, body_para_count + 1):
            sections.append(
                OutlineSection(
                    f"Body Paragraph {i}",
                    words_per_body_para,
                    f"What is your {self._get_ordinal(i)} main argument supporting your thesis?",
                )
            )

        sections.append(
            OutlineSection(
                "Conclusion",
                conclusion_words,
                "How will you summarize and reinforce your thesis?",
            )
        )

        return Outline(sections)

    def _calculate_body_paragraphs(self, word_count: int) -> int:
        if word_count <= 500:
            return 2
        elif word_count <= 800:
            return 3
        elif word_count <= 1200:
            return 4
        else:
            return 5

    def _get_ordinal(self, n: int) -> str:
        ordinals = ["first", "second", "third", "fourth", "fifth"]
        return ordinals[n - 1] if n <= len(ordinals) else f"{n}th"

    def validate(self, essay_data: EssayData) -> bool:
        return essay_data.outline is not None and len(essay_data.outline.sections) > 0


class WriteStage(EssayStage):
    """Stage 3: Write - Section-by-section drafting with TREE guidance"""

    def __init__(self):
        super().__init__("Write", 3)

    def execute(self, essay_data: EssayData) -> Dict[str, Any]:
        logger.info("Stage 3 (Write) started")
        logger.info("Creating writing sections from outline")

        # Initialize sections from outline
        essay_data.sections = [
            EssaySection(
                title=outline_section.title,
                target_words=outline_section.word_count,
                guiding_question=outline_section.guiding_question,
                tree_prompts=self._generate_tree_prompts(outline_section.title),
            )
            for outline_section in essay_data.outline.sections
        ]

        ui_lines = [
            "=== STAGE 3: WRITE (DRAFT) ===",
            "Writing spaces created for each section.",
            "",
            "TREE structure for each section:",
        ]
        for i, section in enumerate(essay_data.sections, 1):
            ui_lines.append(f"📝 Section {i}: {section.title}")
            ui_lines.append(f"   Target: {section.target_words} words")
            if section.guiding_question:
                ui_lines.append(f"   Guide: {section.guiding_question}")
            ui_lines.append("   TREE Structure:")
            for key, prompt in section.tree_prompts.items():
                ui_lines.append(f"     {key} - {prompt}")
            ui_lines.append("")

        logger.info("Initialized %d sections for writing", len(essay_data.sections))

        return {
            "ready": False,  # waiting for user to write content
            "message": "Ready for drafting - content input required",
            "stage": {"name": self.name, "number": self.stage_number},
            "sections": essay_data.sections,
            "ui_lines": ui_lines,
        }

    def _generate_tree_prompts(self, section_title: str) -> Dict[str, str]:
        title_lower = section_title.lower()
        if "introduction" in title_lower:
            return {
                "T": "Topic/Hook sentence - How will you grab attention?",
                "R": "Reasons preview - What main points will you cover?",
                "E1": "Explain context - What background does reader need?",
                "E2": "End with thesis - State your clear position",
            }
        elif "conclusion" in title_lower:
            return {
                "T": "Topic sentence - Restate thesis in new words",
                "R": "Recap main reasons - Summarize key arguments",
                "E1": "Explain significance - Why does this matter?",
                "E2": "End strong - Final thought or call to action",
            }
        else:
            return {
                "T": "Topic sentence - State main claim for this paragraph",
                "R": "Reasons/Evidence - What supports this claim?",
                "E1": "Explain/Analyze - How does evidence prove your point?",
                "E2": "End/Transition - Connect to next paragraph",
            }

    def add_content(
        self, essay_data: EssayData, section_index: int, content: str
    ) -> Dict[str, Any]:
        if not (0 <= section_index < len(essay_data.sections)):
            logger.error("Invalid section index: %s", section_index)
            raise IndexError("Invalid section index")

        section = essay_data.sections[section_index]
        section.content = content
        section.actual_words = self._count_words(content)
        section.completed = section.actual_words > 0

        logger.info(
            "Content added to section '%s': %d/%d words",
            section.title,
            section.actual_words,
            section.target_words,
        )

        # Check if all sections are completed
        all_completed = all(s.completed for s in essay_data.sections)
        if all_completed:
            self.completed = True
            total_words = sum(s.actual_words for s in essay_data.sections)
            logger.info(
                "Draft completed! Total words: %d/%d",
                total_words,
                essay_data.word_count,
            )

        return {
            "completed": section.completed,
            "total_completed": all_completed,
            "section_title": section.title,
            "actual_words": section.actual_words,
            "target_words": section.target_words,
        }

    def _count_words(self, text: str) -> int:
        words = text.strip().split()
        return len([word for word in words if word])

    def validate(self, essay_data: EssayData) -> bool:
        return bool(essay_data.sections) and all(
            section.completed for section in essay_data.sections
        )


class ReviseStage(EssayStage):
    """Stage 4: Revise - 7-pass revision system"""

    def __init__(self):
        super().__init__("Revise", 4)
        self.passes = [
            ThesisFocusPass(),
            StructurePass(),
            ArgumentEvidencePass(),
            FlowCohesionPass(),
            StyleClarityPass(),
            WordCountPass(),
            SpellCheckPass(),
        ]

    def execute(self, essay_data: EssayData) -> Dict[str, Any]:
        logger.info("Stage 4 (Revise) started")
        logger.info("Running revision passes")

        all_issues: List[RevisionIssue] = []
        ui_lines = [
            "=== STAGE 4: REVISE (POLISH) ===",
            "Running revision passes...",
            "",
        ]

        for i, revision_pass in enumerate(self.passes, 1):
            logger.info("Revision pass %d: %s", i, revision_pass.name)
            ui_lines.append(f"🔍 Pass {i}: {revision_pass.name}")
            issues = revision_pass.analyze(essay_data)
            all_issues.extend(issues)

            if not issues:
                ui_lines.append("   ✓ No issues found")
            else:
                for issue in issues:
                    ui_lines.append(
                        f"   ⚠️  {issue.description} ({issue.location}) [severity: {issue.severity}]"
                    )
            ui_lines.append("")

        essay_data.revision_passes = all_issues
        high_priority_issues = [i for i in all_issues if i.severity == "high"]
        self.completed = len(high_priority_issues) == 0

        total_issues = len(all_issues)
        med_issues = len([i for i in all_issues if i.severity == "medium"])
        low_issues = len([i for i in all_issues if i.severity == "low"])

        ui_lines.append("📊 Revision Summary:")
        ui_lines.append(f"   Total issues found: {total_issues}")
        ui_lines.append(f"   High priority: {len(high_priority_issues)}")
        ui_lines.append(f"   Medium priority: {med_issues}")
        ui_lines.append(f"   Low priority: {low_issues}")

        logger.info(
            "Revision summary: total=%d, high=%d, medium=%d, low=%d",
            total_issues,
            len(high_priority_issues),
            med_issues,
            low_issues,
        )

        return {
            "ready": True,
            "message": "Revision analysis completed",
            "issues": all_issues,
            "ready_for_submission": self.completed,
            "stage": {"name": self.name, "number": self.stage_number},
            "ui_lines": ui_lines,
        }

    def validate(self, essay_data: EssayData) -> bool:
        high_priority_issues = [
            i for i in essay_data.revision_passes if i.severity == "high"
        ]
        return len(high_priority_issues) == 0


# ========== REVISION PASSES ==========

class RevisionPass(ABC):
    """Abstract base class for revision passes"""

    def __init__(self, name: str, description: str):
        self.name = name
        self.description = description

    @abstractmethod
    def analyze(self, essay_data: EssayData) -> List[RevisionIssue]:
        """Analyze essay and return issues"""
        pass


class ThesisFocusPass(RevisionPass):
    """Check connection between paragraphs and thesis"""

    def __init__(self):
        super().__init__(
            "Thesis & Focus", "Check connection between paragraphs and thesis"
        )

    def analyze(self, essay_data: EssayData) -> List[RevisionIssue]:
        issues: List[RevisionIssue] = []
        thesis_keywords = self._extract_keywords(essay_data.thesis)

        for section in essay_data.sections:
            if (
                "introduction" in section.title.lower()
                or "conclusion" in section.title.lower()
            ):
                continue  # Skip intro/conclusion

            content_keywords = self._extract_keywords(section.content)
            overlap = self._calculate_overlap(thesis_keywords, content_keywords)

            if overlap < 0.2:  # Less than 20% keyword overlap
                issues.append(
                    RevisionIssue(
                        "thesis_focus",
                        "Paragraph may not connect clearly to thesis",
                        section.title,
                        "medium",
                    )
                )

        return issues

    def _extract_keywords(self, text: str) -> List[str]:
        stop_words = {
            "the",
            "a",
            "an",
            "and",
            "or",
            "but",
            "in",
            "on",
            "at",
            "to",
            "for",
            "of",
            "with",
            "by",
        }
        words = re.findall(r"\b\w+\b", text.lower())
        return [word for word in words if len(word) > 3 and word not in stop_words]

    def _calculate_overlap(self, keywords1: List[str], keywords2: List[str]) -> float:
        if not keywords1:
            return 0.0
        intersection = set(keywords1) & set(keywords2)
        return len(intersection) / len(keywords1)


class StructurePass(RevisionPass):
    """Validate paragraph structure using TREE"""

    def __init__(self):
        super().__init__("Structure (TREE)", "Validate paragraph structure")

    def analyze(self, essay_data: EssayData) -> List[RevisionIssue]:
        issues: List[RevisionIssue] = []

        for section in essay_data.sections:
            content = section.content
            if not content:
                continue

            sentences = [s.strip() for s in content.split(".") if s.strip()]

            # Check for topic sentence
            if sentences:
                first_sentence = sentences[0]
                if self._starts_with_quote(first_sentence) or self._is_question(
                    first_sentence
                ):
                    issues.append(
                        RevisionIssue(
                            "structure",
                            "Consider starting with a clear topic sentence",
                            section.title,
                            "low",
                        )
                    )

            # Check for quotes without explanation
            quotes = re.findall(r'"[^"]+"', content)
            for quote in quotes:
                quote_index = content.index(quote)
                after_quote = content[
                    quote_index + len(quote) : quote_index + len(quote) + 100
                ]
                if len(after_quote.strip().split(".")[0]) < 20:
                    issues.append(
                        RevisionIssue(
                            "structure",
                            "Quote needs more analysis/explanation",
                            section.title,
                            "medium",
                        )
                    )

        return issues

    def _starts_with_quote(self, sentence: str) -> bool:
        return sentence.startswith('"') or sentence.startswith("'")

    def _is_question(self, sentence: str) -> bool:
        return "?" in sentence


class ArgumentEvidencePass(RevisionPass):
    """Check claims are supported with evidence"""

    def __init__(self):
        super().__init__(
            "Argument & Evidence", "Check claims are supported with evidence"
        )

    def analyze(self, essay_data: EssayData) -> List[RevisionIssue]:
        issues: List[RevisionIssue] = []
        strong_claim_words = [
            "shows",
            "proves",
            "demonstrates",
            "leads to",
            "causes",
            "results in",
        ]

        for section in essay_data.sections:
            content = section.content.lower()

            for claim_word in strong_claim_words:
                if claim_word in content:
                    # Check if there's nearby evidence
                    claim_index = content.index(claim_word)
                    surrounding = content[
                        max(0, claim_index - 100) : claim_index + 200
                    ]

                    if not self._has_evidence(surrounding):
                        issues.append(
                            RevisionIssue(
                                "evidence",
                                f'Strong claim "{claim_word}" needs supporting evidence',
                                section.title,
                                "medium",
                            )
                        )

            # Check for consecutive quotes
            quotes = re.findall(r'"[^"]+"', content)
            if len(quotes) >= 2:
                for i in range(len(quotes) - 1):
                    quote1_end = content.index(quotes[i]) + len(quotes[i])
                    quote2_start = content.index(quotes[i + 1])
                    between = content[quote1_end:quote2_start]

                    analysis_sentences = [
                        s.strip()
                        for s in between.split(".")
                        if s.strip() and len(s.strip()) > 10
                    ]
                    if len(analysis_sentences) < 2:
                        issues.append(
                            RevisionIssue(
                                "evidence",
                                "Consecutive quotes need analysis between them",
                                section.title,
                                "medium",
                            )
                        )

        return issues

    def _has_evidence(self, text: str) -> bool:
        evidence_markers = [
            '"',
            "example",
            "study",
            "research",
            "data",
            "according to",
            "statistics",
        ]
        text_lower = text.lower()
        return any(marker in text_lower for marker in evidence_markers)


class FlowCohesionPass(RevisionPass):
    """Check sentence length and transitions"""

    def __init__(self):
        super().__init__("Flow & Cohesion", "Check sentence length and transitions")

    def analyze(self, essay_data: EssayData) -> List[RevisionIssue]:
        issues: List[RevisionIssue] = []

        for i, section in enumerate(essay_data.sections):
            sentences = [s.strip() for s in section.content.split(".") if s.strip()]

            for j, sentence in enumerate(sentences):
                word_count = len(sentence.split())
                if word_count > 35:
                    issues.append(
                        RevisionIssue(
                            "flow",
                            f"Long sentence ({word_count} words) - consider splitting",
                            f"{section.title}, sentence {j + 1}",
                            "low",
                        )
                    )

            # Check transitions between sections
            if 0 < i < len(essay_data.sections) - 1:
                if not self._has_transition_words(section.content):
                    issues.append(
                        RevisionIssue(
                            "cohesion",
                            "Consider adding transition words to connect ideas",
                            section.title,
                            "low",
                        )
                    )

        return issues

    def _has_transition_words(self, text: str) -> bool:
        transitions = [
            "however",
            "therefore",
            "furthermore",
            "moreover",
            "in addition",
            "consequently",
            "thus",
            "meanwhile",
        ]
        text_lower = text.lower()
        return any(transition in text_lower for transition in transitions)


class StyleClarityPass(RevisionPass):
    """Check for filler words and passive voice"""

    def __init__(self):
        super().__init__("Style & Clarity", "Check for filler words and passive voice")

    def analyze(self, essay_data: EssayData) -> List[RevisionIssue]:
        issues: List[RevisionIssue] = []
        filler_phrases = [
            "in general",
            "it should be noted",
            "actually",
            "basically",
            "literally",
        ]

        for section in essay_data.sections:
            content = section.content.lower()

            # Check filler phrases
            for filler in filler_phrases:
                if filler in content:
                    issues.append(
                        RevisionIssue(
                            "style",
                            f'Consider removing filler phrase: "{filler}"',
                            section.title,
                            "low",
                        )
                    )

            # Check passive voice
            passive_pattern = r"\bwas\s+\w+ed\b|\bwere\s+\w+ed\b"
            passive_matches = re.findall(passive_pattern, content)
            if len(passive_matches) > 2:
                issues.append(
                    RevisionIssue(
                        "style",
                        f"Heavy use of passive voice ({len(passive_matches)} instances)",
                        section.title,
                        "low",
                    )
                )

            # Check word repetition
            words = content.split()
            for j in range(len(words) - 2):
                if words[j] == words[j + 1] or words[j] == words[j + 2]:
                    issues.append(
                        RevisionIssue(
                            "style",
                            f'Word repetition: "{words[j]}"',
                            section.title,
                            "low",
                        )
                    )
                    break

        return issues


class WordCountPass(RevisionPass):
    """Check word distribution and target compliance"""

    def __init__(self):
        super().__init__(
            "Word Count & Balance", "Check word distribution and target compliance"
        )

    def analyze(self, essay_data: EssayData) -> List[RevisionIssue]:
        issues: List[RevisionIssue] = []
        total_actual = 0

        for section in essay_data.sections:
            total_actual += section.actual_words
            target = section.target_words
            actual = section.actual_words
            deviation = abs(actual - target) / target if target > 0 else 0

            if deviation > 0.2:  # More than 20% deviation
                issue_type = "over" if actual > target else "under"
                severity = "medium" if deviation > 0.4 else "low"
                issues.append(
                    RevisionIssue(
                        "word_count",
                        f"Section is {issue_type} target by "
                        f"{round(deviation * 100)}% ({actual}/{target} words)",
                        section.title,
                        severity,
                    )
                )

        # Check overall word count
        if essay_data.word_count > 0:
            total_deviation = abs(total_actual - essay_data.word_count) / essay_data.word_count
        else:
            total_deviation = 0

        if total_deviation > 0.1:  # More than 10% deviation
            issue_type = "over" if total_actual > essay_data.word_count else "under"
            severity = "high" if total_deviation > 0.2 else "medium"
            issues.append(
                RevisionIssue(
                    "word_count",
                    f"Essay is {issue_type} target by "
                    f"{round(total_deviation * 100)}% ({total_actual}/{essay_data.word_count} words)",
                    "Overall essay",
                    severity,
                )
            )

        return issues


class SpellCheckPass(RevisionPass):
    """Basic spelling and grammar checks"""

    def __init__(self):
        super().__init__(
            "Spell Check & Mechanics", "Basic spelling and grammar checks"
        )

    def analyze(self, essay_data: EssayData) -> List[RevisionIssue]:
        issues: List[RevisionIssue] = []

        for section in essay_data.sections:
            content = section.content

            # Double spaces
            if "  " in content:
                issues.append(
                    RevisionIssue(
                        "mechanics",
                        "Found double spaces",
                        section.title,
                        "low",
                    )
                )

            # Repeated words
            repeated_pattern = r"\b(\w+)\s+\1\b"
            repeated_matches = re.findall(repeated_pattern, content, re.IGNORECASE)
            if repeated_matches:
                issues.append(
                    RevisionIssue(
                        "mechanics",
                        f"Repeated words found: {', '.join(repeated_matches)}",
                        section.title,
                        "medium",
                    )
                )

            # Basic punctuation: lowercase after punctuation
            if re.search(r"[.!?]\s*[a-z]", content):
                issues.append(
                    RevisionIssue(
                        "mechanics",
                        "Check capitalization after punctuation",
                        section.title,
                        "medium",
                    )
                )

        return issues


# ========== MAIN ESSAY ASSISTANT TASK ==========

class EssayAssistantTask(Task):
    """Main essay assistant task implementing SRSD methodology"""

    def __init__(self, params: Dict[str, Any]):
        super().__init__(params)
        self.essay_data = EssayData()
        self.stages: List[EssayStage] = [
            PickIdeasStage(),
            OrganizeStage(),
            WriteStage(),
            ReviseStage(),
        ]
        self.timeline: Optional[Dict[str, Any]] = None

    def validate_params(self) -> bool:
        """Validate input parameters"""
        topic = self.params.get("topic", "").strip()
        essay_type = self.params.get("essay_type", "")
        word_count = self.params.get("word_count", 0)
        deadline = self.params.get("deadline")

        errors = []

        if not topic:
            errors.append("Topic is required")

        valid_types = ["opinion", "analytical", "comparative", "interpretive"]
        if essay_type not in valid_types:
            errors.append(
                f"Valid essay type is required ({', '.join(valid_types)})"
            )

        if not isinstance(word_count, int) or not (100 <= word_count <= 5000):
            errors.append("Word count must be between 100 and 5000")

        try:
            deadline_dt = (
                datetime.fromisoformat(deadline)
                if isinstance(deadline, str)
                else deadline
            )
            if not isinstance(deadline_dt, datetime) or deadline_dt <= datetime.now():
                errors.append("Deadline must be in the future")
        except (ValueError, TypeError):
            errors.append("Invalid deadline format")

        if errors:
            logger.error("EssayAssistantTask params validation failed: %s", errors)
            raise ValueError(f"Validation failed: {', '.join(errors)}")

        # Set validated params to essay data
        self.essay_data.topic = topic
        self.essay_data.essay_type = essay_type
        self.essay_data.word_count = word_count
        self.essay_data.deadline = (
            datetime.fromisoformat(deadline)
            if isinstance(deadline, str)
            else deadline
        )

        logger.info(
            "EssayAssistantTask params validated: topic=%s, type=%s, word_count=%d, deadline=%s",
            topic,
            essay_type,
            word_count,
            self.essay_data.deadline,
        )

        return True

    def start(self) -> Dict[str, Any]:
        """Start the essay assistant task"""
        self.validate_params()
        self._generate_timeline()
        self.status = TaskStatus.ACTIVE

        intro_lines = [
            "🚀 STARTING ESSAY ASSISTANT",
            "============================",
            f"Topic: {self.essay_data.topic}",
            f"Type: {self.essay_data.essay_type}",
            f"Target: {self.essay_data.word_count} words",
            f"Deadline: {self.essay_data.deadline.strftime('%Y-%m-%d')}",
            "",
        ]
        timeline_lines = self._format_timeline_lines()
        intro_lines.extend(timeline_lines)

        logger.info("EssayAssistantTask started for topic: %s", self.essay_data.topic)

        stage_payload = self._execute_current_stage()
        existing_lines = stage_payload.get("ui_lines", [])
        stage_payload["ui_lines"] = intro_lines + ([""] if existing_lines else []) + existing_lines

        return stage_payload

    def _generate_timeline(self):
        """Generate a timeline based on deadline"""
        now = datetime.now()
        deadline = self.essay_data.deadline
        total_days = (deadline - now).days

        if total_days < 1:
            logger.error("Not enough time to complete essay: total_days=%d", total_days)
            raise ValueError("Not enough time to complete essay")

        # Distribute days across stages
        if total_days >= 7:
            stage_distribution = {
                "ideas": 1,
                "organize": 1,
                "write": max(2, int(total_days * 0.6)),
                "revise": max(1, int(total_days * 0.3)),
            }
        else:
            stage_distribution = {
                "ideas": 1,
                "organize": 1,
                "write": max(1, total_days - 2),
                "revise": 1,
            }

        stages = [
            {"name": "Pick Ideas", "days": stage_distribution["ideas"], "start_day": 1},
            {
                "name": "Organize",
                "days": stage_distribution["organize"],
                "start_day": 1 + stage_distribution["ideas"],
            },
            {
                "name": "Write",
                "days": stage_distribution["write"],
                "start_day": 2 + stage_distribution["ideas"],
            },
            {
                "name": "Revise",
                "days": stage_distribution["revise"],
                "start_day": 2
                + stage_distribution["ideas"]
                + stage_distribution["write"],
            },
        ]

        self.timeline = {
            "total_days": total_days,
            "stages": stages,
        }

        logger.info("Timeline generated: %s", self.timeline)

    def _format_timeline_lines(self) -> List[str]:
        """Return suggested timeline as list of UI lines"""
        if not self.timeline:
            return []

        lines = ["📅 SUGGESTED TIMELINE:"]
        for i, stage in enumerate(self.timeline["stages"], 1):
            end_day = stage["start_day"] + stage["days"] - 1
            days_text = f"Day {stage['start_day']}" + (
                f"-{end_day}" if stage["days"] > 1 else ""
            )
            lines.append(
                f"   {i}. {stage['name']}: {days_text} "
                f"({stage['days']} day{'s' if stage['days'] > 1 else ''})"
            )
        return lines

    def _execute_current_stage(self) -> Dict[str, Any]:
        """Execute the current stage"""
        if self.current_stage >= len(self.stages):
            self.status = TaskStatus.COMPLETED
            logger.info("Essay task completed: all stages finished")
            return {"completed": True, "message": "Essay task completed"}

        stage = self.stages[self.current_stage]
        logger.info(
            "Executing stage %d: %s", self.current_stage + 1, stage.name
        )
        return stage.execute(self.essay_data)

    def next_stage(self) -> Dict[str, Any]:
        """Advance to the next stage"""
        current_stage = self.stages[self.current_stage]

        if not current_stage.validate(self.essay_data):
            logger.warning(
                "Cannot advance from stage '%s': validation failed",
                current_stage.name,
            )
            raise ValueError(
                f"Cannot advance: Stage {current_stage.name} not completed properly"
            )

        self.current_stage += 1

        if self.current_stage >= len(self.stages):
            self.status = TaskStatus.COMPLETED
            logger.info("All essay stages completed")
            return {"completed": True, "message": "All stages completed"}

        return self._execute_current_stage()

    # Helper methods for interacting with specific stages
    def set_thesis(self, thesis: str) -> Dict[str, Any]:
        """Set thesis in Pick Ideas stage"""
        if self.current_stage != 0:
            logger.error("set_thesis called in wrong stage: %d", self.current_stage)
            raise ValueError("Can only set thesis in Pick Ideas stage")
        return self.stages[0].set_thesis(self.essay_data, thesis)

    def add_section_content(
        self, section_index: int, content: str
    ) -> Dict[str, Any]:
        """Add content to a section in Write stage"""
        if self.current_stage != 2:
            logger.error(
                "add_section_content called in wrong stage: %d", self.current_stage
            )
            raise ValueError("Can only add content in Write stage")
        return self.stages[2].add_content(self.essay_data, section_index, content)

    def get_essay_status(self) -> Dict[str, Any]:
        """Get comprehensive essay status"""
        total_words = sum(section.actual_words for section in self.essay_data.sections)

        return {
            "task_id": self.id,
            "status": self.status.value,
            "current_stage": self.current_stage + 1,
            "stage_name": self.stages[self.current_stage].name
            if self.current_stage < len(self.stages)
            else "Completed",
            "progress": f"{round((self.current_stage / len(self.stages)) * 100)}%",
            "essay_data": {
                "topic": self.essay_data.topic,
                "essay_type": self.essay_data.essay_type,
                "thesis": self.essay_data.thesis,
                "target_words": self.essay_data.word_count,
                "actual_words": total_words,
                "sections": len(self.essay_data.sections),
                "completed_sections": len(
                    [s for s in self.essay_data.sections if s.completed]
                ),
                "issues": len(self.essay_data.revision_passes),
                "high_priority_issues": len(
                    [i for i in self.essay_data.revision_passes if i.severity == "high"]
                ),
            },
            "timeline": self.timeline,
        }

    def get_full_essay_text(self) -> str:
        """Get the complete essay text"""
        return "\n\n".join(
            section.content
            for section in self.essay_data.sections
            if section.content.strip()
        )


# ========== READING ASSISTANT TASK ==========

@dataclass
class ReadingChunk:
    source_id: str
    source_title: str
    paragraph_index: int  # 1-based index
    total_paragraphs_for_source: int
    text: str


class ReadingAssistantTask(Task):
    """Task that helps read multiple texts by interleaving their paragraphs.

    Parameters expected in `params`:
    - texts: List[str] or List[dict{text: str, title?: str, id?: str}]
    - seed: Optional[int | str] (for reproducible shuffling)
    - shuffle_each_round: bool = True (shuffle order of sources for each paragraph layer)
    - sentences_per_fallback_paragraph: int = 8 (when a text has no blank lines)
    """

    def __init__(self, params: Dict[str, Any]):
        super().__init__(params)
        self.sources: List[Dict[str, Any]] = []  # each: {id, title, paragraphs}
        self.queue: List[ReadingChunk] = []
        self.current_index: int = 0
        self.shuffle_each_round: bool = True
        self._rng: random.Random = random.Random()

    # ---- lifecycle ----
    def validate_params(self) -> bool:
        texts = self.params.get("texts")
        if not isinstance(texts, list) or not texts:
            logger.error('Reading task missing "texts" list')
            raise ValueError(
                'Reading task requires "texts": list[str] or list[dict{text, title?, id?}]'
            )

        normalized_sources: List[Dict[str, Any]] = []
        for i, item in enumerate(texts, start=1):
            if isinstance(item, str):
                text = item
                title = f"Text {i}"
                sid = f"text_{i}"
            elif isinstance(item, dict) and "text" in item:
                text = str(item.get("text", ""))
                title = str(item.get("title") or f"Text {i}")
                sid = str(item.get("id") or f"text_{i}")
            else:
                logger.error("Invalid item for ReadingAssistantTask at index %d", i - 1)
                raise ValueError(
                    f'Invalid item at index {i-1}: must be str or dict with "text" key'
                )

            if not text or not text.strip():
                continue  # skip empties silently
            paragraphs = self._split_into_paragraphs(text)
            normalized_sources.append(
                {"id": sid, "title": title, "paragraphs": paragraphs}
            )

        if not normalized_sources:
            logger.error("No non-empty texts provided to ReadingAssistantTask")
            raise ValueError("No non-empty texts provided")

        self.sources = normalized_sources
        self.shuffle_each_round = bool(self.params.get("shuffle_each_round", True))
        seed = self.params.get("seed", None)
        self._rng = random.Random(seed) if seed is not None else random.Random()

        logger.info(
            "ReadingAssistantTask params validated: %d sources, shuffle_each_round=%s",
            len(self.sources),
            self.shuffle_each_round,
        )
        return True

    def start(self) -> Dict[str, Any]:
        self.validate_params()
        self.status = TaskStatus.ACTIVE
        self._build_queue()

        logger.info("ReadingAssistantTask started with %d sources", len(self.sources))
        for i, s in enumerate(self.sources, 1):
            logger.info(
                "Source %d: %s (%d paragraphs)",
                i,
                s["title"],
                len(s["paragraphs"]),
            )
        logger.info("Total interleaved chunks: %d", len(self.queue))

        ui_lines = [
            "📚 STARTING READING ASSISTANT",
            "=============================",
            f"Sources: {len(self.sources)}",
        ]
        for i, s in enumerate(self.sources, 1):
            ui_lines.append(
                f"   {i}. {s['title']} ({len(s['paragraphs'])} paragraphs)"
            )
        ui_lines.append(f"Total interleaved chunks: {len(self.queue)}")

        preview = self._preview_next()
        existing = preview.get("ui_lines", [])
        preview["ui_lines"] = ui_lines + ([""] if existing else []) + existing
        return preview

    # ---- public API ----
    def get_next_chunk(self) -> Dict[str, Any]:
        """Return the next interleaved paragraph chunk (and advance)."""
        if self.current_index >= len(self.queue):
            self.status = TaskStatus.COMPLETED
            logger.info("ReadingAssistantTask completed: no more chunks")
            return {"completed": True, "message": "No more chunks."}
        chunk = self.queue[self.current_index]
        self.current_index += 1
        if self.current_index >= len(self.queue):
            self.status = TaskStatus.COMPLETED
        return {
            "chunk_number": self.current_index,
            "total_chunks": len(self.queue),
            "chunk": chunk.__dict__,
            "remaining": len(self.queue) - self.current_index,
            "completed": self.status == TaskStatus.COMPLETED,
        }

    def get_reading_status(self) -> Dict[str, Any]:
        """Detailed status for TaskManager.get_task_status()."""
        next_meta = None
        if self.current_index < len(self.queue):
            nxt = self.queue[self.current_index]
            next_meta = {
                "source_id": nxt.source_id,
                "source_title": nxt.source_title,
                "paragraph_index": nxt.paragraph_index,
                "total_paragraphs_for_source": nxt.total_paragraphs_for_source,
            }
        return {
            "task_id": self.id,
            "status": self.status.value,
            "type": self.type,
            "progress": f"{round((self.current_index / max(1, len(self.queue))) * 100)}%",
            "sources": [
                {
                    "id": s["id"],
                    "title": s["title"],
                    "paragraphs": len(s["paragraphs"]),
                }
                for s in self.sources
            ],
            "delivered": self.current_index,
            "remaining": max(0, len(self.queue) - self.current_index),
            "total_chunks": len(self.queue),
            "next_chunk": next_meta,
        }

    # ---- internals ----
    def _split_into_paragraphs(self, text: str) -> List[str]:
        # Normalize newlines
        normalized = re.sub(r"\r\n?", "\n", text)
        normalized = re.sub(r"\n{3,}", "\n\n", normalized)
        paragraphs = [
            p.strip() for p in re.split(r"\n\s*\n", normalized) if p.strip()
        ]

        # Fallback: if there is a single very long block, chunk by sentences
        if len(paragraphs) == 1:
            sentences = re.split(r"(?<=[.!?])\s+", paragraphs[0])
            max_sent = int(self.params.get("sentences_per_fallback_paragraph", 8))
            if len(sentences) > max_sent:
                paragraphs = [
                    " ".join(sentences[i : i + max_sent]).strip()
                    for i in range(0, len(sentences), max_sent)
                ]
                paragraphs = [p for p in paragraphs if p]
        return paragraphs

    def _build_queue(self) -> None:
        max_len = max(len(s["paragraphs"]) for s in self.sources)
        queue: List[ReadingChunk] = []
        for p_idx in range(max_len):
            order = [
                i
                for i, s in enumerate(self.sources)
                if p_idx < len(s["paragraphs"])
            ]
            if self.shuffle_each_round and len(order) > 1:
                self._rng.shuffle(order)
            for i in order:
                s = self.sources[i]
                queue.append(
                    ReadingChunk(
                        source_id=s["id"],
                        source_title=s["title"],
                        paragraph_index=p_idx + 1,
                        total_paragraphs_for_source=len(s["paragraphs"]),
                        text=s["paragraphs"][p_idx],
                    )
                )
        self.queue = queue
        self.current_index = 0

    def _preview_next(self) -> Dict[str, Any]:
        if self.current_index >= len(self.queue):
            self.status = TaskStatus.COMPLETED
            return {
                "completed": True,
                "message": "All chunks delivered",
                "remaining": 0,
            }
        nxt = self.queue[self.current_index]
        return {
            "ready": True,
            "message": "Use TaskManager.advance_task(task_id) to pull the next chunk.",
            "next_chunk_meta": {
                "source_id": nxt.source_id,
                "source_title": nxt.source_title,
                "paragraph_index": nxt.paragraph_index,
                "total_paragraphs_for_source": nxt.total_paragraphs_for_source,
            },
            "remaining": len(self.queue) - self.current_index,
        }


# ========== TASK MANAGER ==========

class TaskManager:
    """Manages multiple tasks and their lifecycle"""

    def __init__(self):
        self.tasks: Dict[str, Task] = {}

    def create_task(self, task_type: str, params: Dict[str, Any]) -> Task:
        """Create a new task"""
        task = TaskFactory.create_task(task_type, params)
        self.tasks[task.id] = task
        logger.info("Task created: id=%s, type=%s", task.id, task.type)
        return task

    def get_task(self, task_id: str) -> Task:
        """Get a task by ID"""
        if task_id not in self.tasks:
            logger.error("Task not found: %s", task_id)
            raise KeyError(f"Task not found: {task_id}")
        return self.tasks[task_id]

    def start_task(self, task_id: str) -> Dict[str, Any]:
        """Start a task"""
        task = self.get_task(task_id)
        logger.info("Starting task: id=%s, type=%s", task.id, task.type)
        return task.start()

    def advance_task(self, task_id: str) -> Dict[str, Any]:
        """Advance a task to next stage or fetch next chunk for reading tasks"""
        task = self.get_task(task_id)
        logger.info("Advancing task: id=%s, type=%s", task.id, task.type)
        if isinstance(task, EssayAssistantTask):
            return task.next_stage()
        elif isinstance(task, ReadingAssistantTask):
            return task.get_next_chunk()
        else:
            raise ValueError("Task type does not support stage advancement")

    def get_task_status(self, task_id: str) -> Dict[str, Any]:
        """Get task status"""
        task = self.get_task(task_id)
        if isinstance(task, EssayAssistantTask):
            return task.get_essay_status()
        elif isinstance(task, ReadingAssistantTask):
            return task.get_reading_status()
        else:
            return task.save()

    def get_all_tasks(self) -> List[Dict[str, Any]]:
        """Get all tasks summary"""
        return [
            {
                "id": task.id,
                "type": task.type,
                "status": task.status.value,
                "created_at": task.created_at.isoformat(),
            }
            for task in self.tasks.values()
        ]

    def delete_task(self, task_id: str) -> bool:
        """Delete a task"""
        if task_id in self.tasks:
            logger.info("Deleting task: %s", task_id)
            del self.tasks[task_id]
            return True
        logger.warning("Delete called for non-existent task: %s", task_id)
        return False