#!/usr/bin/env python3

import re
import json
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from enum import Enum
import uuid


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
            'id': self.id,
            'type': self.type,
            'status': self.status.value,
            'current_stage': self.current_stage,
            'params': self.params,
            'created_at': self.created_at.isoformat()
        }


class TaskFactory:
    """Factory for creating different task types"""
    
    @staticmethod
    def create_task(task_type: str, params: Dict[str, Any]) -> Task:
        if task_type == 'essay':
            return EssayAssistantTask(params)
        elif task_type == 'reading':
            raise NotImplementedError('Reading assistant not implemented yet')
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
    outline: Optional['Outline'] = None
    sections: List['EssaySection'] = field(default_factory=list)
    revision_passes: List['RevisionIssue'] = field(default_factory=list)
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
        total = self.total_words
        return [
            {
                'title': section.title,
                'word_count': section.word_count,
                'percentage': round((section.word_count / total) * 100, 1)
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
        super().__init__('Pick Ideas', 1)
    
    def execute(self, essay_data: EssayData) -> Dict[str, Any]:
        print(f"\n=== STAGE 1: PICK IDEAS ===")
        print(f"Topic: {essay_data.topic}")
        print(f"Essay Type: {essay_data.essay_type}")
        
        print('Please provide your thesis statement (1-2 sentences)')
        print('Your thesis should be:')
        print('- Debatable (not a fact)')
        print('- Relevant to the topic')
        print('- Scalable to target word count')
        
        return {
            'ready': False,  # Waiting for user input
            'message': 'Thesis input required'
        }
    
    def set_thesis(self, essay_data: EssayData, thesis: str) -> Dict[str, Any]:
        if not self._validate_thesis(thesis):
            raise ValueError('Invalid thesis statement')
        
        essay_data.thesis = thesis
        self.completed = True
        
        print(f'✓ Thesis confirmed: "{thesis}"')
        return {'ready': True, 'message': 'Thesis set successfully'}
    
    def _validate_thesis(self, thesis: str) -> bool:
        if not thesis or len(thesis.strip()) < 10:
            return False
        
        sentences = [s.strip() for s in thesis.split('.') if s.strip()]
        return 1 <= len(sentences) <= 2
    
    def validate(self, essay_data: EssayData) -> bool:
        return bool(essay_data.thesis)


class OrganizeStage(EssayStage):
    """Stage 2: Organize - Generate outline with word distribution"""
    
    def __init__(self):
        super().__init__('Organize', 2)
    
    def execute(self, essay_data: EssayData) -> Dict[str, Any]:
        print(f"\n=== STAGE 2: ORGANIZE (OUTLINE) ===")
        print(f'Creating outline for: "{essay_data.thesis}"')
        
        outline = self._generate_outline(essay_data)
        essay_data.outline = outline
        self.completed = True
        
        print('\n📋 Generated Outline:')
        for i, section in enumerate(outline.sections, 1):
            print(f"{i}. {section.title} ({section.word_count} words)")
            if section.guiding_question:
                print(f"   → {section.guiding_question}")
        
        return {
            'ready': True,
            'message': 'Outline generated successfully',
            'data': outline
        }
    
    def _generate_outline(self, essay_data: EssayData) -> Outline:
        total_words = essay_data.word_count
        sections = []
        
        # Word distribution (MVP percentages)
        intro_words = round(total_words * 0.125)  # 12.5%
        conclusion_words = round(total_words * 0.125)  # 12.5%
        body_words = total_words - intro_words - conclusion_words  # 75%
        
        # Determine number of body paragraphs
        body_para_count = self._calculate_body_paragraphs(total_words)
        words_per_body_para = round(body_words / body_para_count)
        
        # Create sections
        sections.append(OutlineSection(
            'Introduction',
            intro_words,
            'How will you introduce the topic and present your thesis?'
        ))
        
        for i in range(1, body_para_count + 1):
            sections.append(OutlineSection(
                f'Body Paragraph {i}',
                words_per_body_para,
                f'What is your {self._get_ordinal(i)} main argument supporting your thesis?'
            ))
        
        sections.append(OutlineSection(
            'Conclusion',
            conclusion_words,
            'How will you summarize and reinforce your thesis?'
        ))
        
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
        ordinals = ['first', 'second', 'third', 'fourth', 'fifth']
        return ordinals[n - 1] if n <= len(ordinals) else f'{n}th'
    
    def validate(self, essay_data: EssayData) -> bool:
        return essay_data.outline is not None and len(essay_data.outline.sections) > 0


class WriteStage(EssayStage):
    """Stage 3: Write - Section-by-section drafting with TREE guidance"""
    
    def __init__(self):
        super().__init__('Write', 3)
    
    def execute(self, essay_data: EssayData) -> Dict[str, Any]:
        print(f"\n=== STAGE 3: WRITE (DRAFT) ===")
        print('Creating writing spaces for each section...\n')
        
        # Initialize sections from outline
        essay_data.sections = [
            EssaySection(
                title=outline_section.title,
                target_words=outline_section.word_count,
                guiding_question=outline_section.guiding_question,
                tree_prompts=self._generate_tree_prompts(outline_section.title)
            )
            for outline_section in essay_data.outline.sections
        ]
        
        self._display_writing_guidance(essay_data)
        
        return {
            'ready': False,  # Waiting for user to write content
            'message': 'Ready for drafting - content input required',
            'sections': essay_data.sections
        }
    
    def _generate_tree_prompts(self, section_title: str) -> Dict[str, str]:
        title_lower = section_title.lower()
        
        if 'introduction' in title_lower:
            return {
                'T': 'Topic/Hook sentence - How will you grab attention?',
                'R': 'Reasons preview - What main points will you cover?',
                'E': 'Explain context - What background does reader need?',
                'E': 'End with thesis - State your clear position'
            }
        elif 'conclusion' in title_lower:
            return {
                'T': 'Topic sentence - Restate thesis in new words',
                'R': 'Recap main reasons - Summarize key arguments',
                'E': 'Explain significance - Why does this matter?',
                'E': 'End strong - Final thought or call to action'
            }
        else:
            return {
                'T': 'Topic sentence - State main claim for this paragraph',
                'R': 'Reasons/Evidence - What supports this claim?',
                'E': 'Explain/Analyze - How does evidence prove your point?',
                'E': 'End/Transition - Connect to next paragraph'
            }
    
    def _display_writing_guidance(self, essay_data: EssayData):
        for i, section in enumerate(essay_data.sections, 1):
            print(f"📝 Section {i}: {section.title}")
            print(f"   Target: {section.target_words} words")
            print(f"   Guide: {section.guiding_question}")
            print('   TREE Structure:')
            for key, prompt in section.tree_prompts.items():
                print(f"     {key} - {prompt}")
            print('')
    
    def add_content(self, essay_data: EssayData, section_index: int, content: str) -> Dict[str, Any]:
        if not (0 <= section_index < len(essay_data.sections)):
            raise IndexError('Invalid section index')
        
        section = essay_data.sections[section_index]
        section.content = content
        section.actual_words = self._count_words(content)
        section.completed = section.actual_words > 0
        
        print(f"✓ Content added to {section.title}: {section.actual_words}/{section.target_words} words")
        
        # Check if all sections are completed
        all_completed = all(s.completed for s in essay_data.sections)
        if all_completed:
            self.completed = True
            total_words = sum(s.actual_words for s in essay_data.sections)
            print(f"\n🎉 Draft completed! Total words: {total_words}/{essay_data.word_count}")
        
        return {'completed': section.completed, 'total_completed': all_completed}
    
    def _count_words(self, text: str) -> int:
        words = text.strip().split()
        return len([word for word in words if word])
    
    def validate(self, essay_data: EssayData) -> bool:
        return (essay_data.sections and 
                all(section.completed for section in essay_data.sections))


class ReviseStage(EssayStage):
    """Stage 4: Revise - 7-pass revision system"""
    
    def __init__(self):
        super().__init__('Revise', 4)
        self.passes = [
            ThesisFocusPass(),
            StructurePass(),
            ArgumentEvidencePass(),
            FlowCohesionPass(),
            StyleClarityPass(),
            WordCountPass(),
            SpellCheckPass()
        ]
    
    def execute(self, essay_data: EssayData) -> Dict[str, Any]:
        print(f"\n=== STAGE 4: REVISE (POLISH) ===")
        print('Running revision passes...\n')
        
        all_issues = []
        
        for i, revision_pass in enumerate(self.passes, 1):
            print(f"🔍 Pass {i}: {revision_pass.name}")
            issues = revision_pass.analyze(essay_data)
            all_issues.extend(issues)
            
            if not issues:
                print('   ✓ No issues found')
            else:
                for issue in issues:
                    print(f"   ⚠️  {issue.description} ({issue.location})")
            print('')
        
        essay_data.revision_passes = all_issues
        high_priority_issues = [i for i in all_issues if i.severity == 'high']
        self.completed = len(high_priority_issues) == 0
        
        print(f"📊 Revision Summary:")
        print(f"   Total issues found: {len(all_issues)}")
        print(f"   High priority: {len([i for i in all_issues if i.severity == 'high'])}")
        print(f"   Medium priority: {len([i for i in all_issues if i.severity == 'medium'])}")
        print(f"   Low priority: {len([i for i in all_issues if i.severity == 'low'])}")
        
        return {
            'ready': True,
            'message': 'Revision analysis completed',
            'issues': all_issues,
            'ready_for_submission': self.completed
        }
    
    def validate(self, essay_data: EssayData) -> bool:
        high_priority_issues = [i for i in essay_data.revision_passes if i.severity == 'high']
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
        super().__init__('Thesis & Focus', 'Check connection between paragraphs and thesis')
    
    def analyze(self, essay_data: EssayData) -> List[RevisionIssue]:
        issues = []
        thesis_keywords = self._extract_keywords(essay_data.thesis)
        
        for section in essay_data.sections:
            if ('introduction' in section.title.lower() or 
                'conclusion' in section.title.lower()):
                continue  # Skip intro/conclusion
            
            content_keywords = self._extract_keywords(section.content)
            overlap = self._calculate_overlap(thesis_keywords, content_keywords)
            
            if overlap < 0.2:  # Less than 20% keyword overlap
                issues.append(RevisionIssue(
                    'thesis_focus',
                    'Paragraph may not connect clearly to thesis',
                    section.title,
                    'medium'
                ))
        
        return issues
    
    def _extract_keywords(self, text: str) -> List[str]:
        stop_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 
                     'to', 'for', 'of', 'with', 'by'}
        words = re.findall(r'\b\w+\b', text.lower())
        return [word for word in words if len(word) > 3 and word not in stop_words]
    
    def _calculate_overlap(self, keywords1: List[str], keywords2: List[str]) -> float:
        if not keywords1:
            return 0
        intersection = set(keywords1) & set(keywords2)
        return len(intersection) / len(keywords1)


class StructurePass(RevisionPass):
    """Validate paragraph structure using TREE"""
    
    def __init__(self):
        super().__init__('Structure (TREE)', 'Validate paragraph structure')
    
    def analyze(self, essay_data: EssayData) -> List[RevisionIssue]:
        issues = []
        
        for section in essay_data.sections:
            content = section.content
            if not content:
                continue
            
            sentences = [s.strip() for s in content.split('.') if s.strip()]
            
            # Check for topic sentence
            if sentences:
                first_sentence = sentences[0]
                if (self._starts_with_quote(first_sentence) or 
                    self._is_question(first_sentence)):
                    issues.append(RevisionIssue(
                        'structure',
                        'Consider starting with a clear topic sentence',
                        section.title,
                        'low'
                    ))
            
            # Check for quotes without explanation
            quotes = re.findall(r'"[^"]+"', content)
            for quote in quotes:
                quote_index = content.index(quote)
                after_quote = content[quote_index + len(quote):quote_index + len(quote) + 100]
                if len(after_quote.strip().split('.')[0]) < 20:
                    issues.append(RevisionIssue(
                        'structure',
                        'Quote needs more analysis/explanation',
                        section.title,
                        'medium'
                    ))
        
        return issues
    
    def _starts_with_quote(self, sentence: str) -> bool:
        return sentence.startswith('"') or sentence.startswith("'")
    
    def _is_question(self, sentence: str) -> bool:
        return '?' in sentence


class ArgumentEvidencePass(RevisionPass):
    """Check claims are supported with evidence"""
    
    def __init__(self):
        super().__init__('Argument & Evidence', 'Check claims are supported with evidence')
    
    def analyze(self, essay_data: EssayData) -> List[RevisionIssue]:
        issues = []
        strong_claim_words = ['shows', 'proves', 'demonstrates', 'leads to', 'causes', 'results in']
        
        for section in essay_data.sections:
            content = section.content.lower()
            
            for claim_word in strong_claim_words:
                if claim_word in content:
                    # Check if there's nearby evidence
                    claim_index = content.index(claim_word)
                    surrounding = content[max(0, claim_index - 100):claim_index + 200]
                    
                    if not self._has_evidence(surrounding):
                        issues.append(RevisionIssue(
                            'evidence',
                            f'Strong claim "{claim_word}" needs supporting evidence',
                            section.title,
                            'medium'
                        ))
            
            # Check for consecutive quotes
            quotes = re.findall(r'"[^"]+"', content)
            if len(quotes) >= 2:
                for i in range(len(quotes) - 1):
                    quote1_end = content.index(quotes[i]) + len(quotes[i])
                    quote2_start = content.index(quotes[i + 1])
                    between = content[quote1_end:quote2_start]
                    
                    analysis_sentences = [s.strip() for s in between.split('.') 
                                        if s.strip() and len(s.strip()) > 10]
                    if len(analysis_sentences) < 2:
                        issues.append(RevisionIssue(
                            'evidence',
                            'Consecutive quotes need analysis between them',
                            section.title,
                            'medium'
                        ))
        
        return issues
    
    def _has_evidence(self, text: str) -> bool:
        evidence_markers = ['"', 'example', 'study', 'research', 'data', 'according to', 'statistics']
        return any(marker in text for marker in evidence_markers)


class FlowCohesionPass(RevisionPass):
    """Check sentence length and transitions"""
    
    def __init__(self):
        super().__init__('Flow & Cohesion', 'Check sentence length and transitions')
    
    def analyze(self, essay_data: EssayData) -> List[RevisionIssue]:
        issues = []
        
        for i, section in enumerate(essay_data.sections):
            sentences = [s.strip() for s in section.content.split('.') if s.strip()]
            
            for j, sentence in enumerate(sentences):
                word_count = len(sentence.split())
                if word_count > 35:
                    issues.append(RevisionIssue(
                        'flow',
                        f'Long sentence ({word_count} words) - consider splitting',
                        f'{section.title}, sentence {j + 1}',
                        'low'
                    ))
            
            # Check transitions between sections
            if 0 < i < len(essay_data.sections) - 1:
                if not self._has_transition_words(section.content):
                    issues.append(RevisionIssue(
                        'cohesion',
                        'Consider adding transition words to connect ideas',
                        section.title,
                        'low'
                    ))
        
        return issues
    
    def _has_transition_words(self, text: str) -> bool:
        transitions = ['however', 'therefore', 'furthermore', 'moreover', 
                      'in addition', 'consequently', 'thus', 'meanwhile']
        text_lower = text.lower()
        return any(transition in text_lower for transition in transitions)


class StyleClarityPass(RevisionPass):
    """Check for filler words and passive voice"""
    
    def __init__(self):
        super().__init__('Style & Clarity', 'Check for filler words and passive voice')
    
    def analyze(self, essay_data: EssayData) -> List[RevisionIssue]:
        issues = []
        filler_phrases = ['in general', 'it should be noted', 'actually', 'basically', 'literally']
        
        for section in essay_data.sections:
            content = section.content.lower()
            
            # Check filler phrases
            for filler in filler_phrases:
                if filler in content:
                    issues.append(RevisionIssue(
                        'style',
                        f'Consider removing filler phrase: "{filler}"',
                        section.title,
                        'low'
                    ))
            
            # Check passive voice
            passive_pattern = r'\bwas\s+\w+ed\b|\bwere\s+\w+ed\b'
            passive_matches = re.findall(passive_pattern, content)
            if len(passive_matches) > 2:
                issues.append(RevisionIssue(
                    'style',
                    f'Heavy use of passive voice ({len(passive_matches)} instances)',
                    section.title,
                    'low'
                ))
            
            # Check word repetition
            words = content.split()
            for j in range(len(words) - 2):
                if words[j] == words[j + 1] or words[j] == words[j + 2]:
                    issues.append(RevisionIssue(
                        'style',
                        f'Word repetition: "{words[j]}"',
                        section.title,
                        'low'
                    ))
                    break
        
        return issues


class WordCountPass(RevisionPass):
    """Check word distribution and target compliance"""
    
    def __init__(self):
        super().__init__('Word Count & Balance', 'Check word distribution and target compliance')
    
    def analyze(self, essay_data: EssayData) -> List[RevisionIssue]:
        issues = []
        total_actual = 0
        
        for section in essay_data.sections:
            total_actual += section.actual_words
            target = section.target_words
            actual = section.actual_words
            deviation = abs(actual - target) / target if target > 0 else 0
            
            if deviation > 0.2:  # More than 20% deviation
                issue_type = 'over' if actual > target else 'under'
                severity = 'medium' if deviation > 0.4 else 'low'
                issues.append(RevisionIssue(
                    'word_count',
                    f'Section is {issue_type} target by {round(deviation * 100)}% ({actual}/{target} words)',
                    section.title,
                    severity
                ))
        
        # Check overall word count
        total_deviation = abs(total_actual - essay_data.word_count) / essay_data.word_count
        if total_deviation > 0.1:  # More than 10% deviation
            issue_type = 'over' if total_actual > essay_data.word_count else 'under'
            severity = 'high' if total_deviation > 0.2 else 'medium'
            issues.append(RevisionIssue(
                'word_count',
                f'Essay is {issue_type} target by {round(total_deviation * 100)}% ({total_actual}/{essay_data.word_count} words)',
                'Overall essay',
                severity
            ))
        
        return issues


class SpellCheckPass(RevisionPass):
    """Basic spelling and grammar checks"""
    
    def __init__(self):
        super().__init__('Spell Check & Mechanics', 'Basic spelling and grammar checks')
    
    def analyze(self, essay_data: EssayData) -> List[RevisionIssue]:
        issues = []
        
        for section in essay_data.sections:
            content = section.content
            
            # Double spaces
            if '  ' in content:
                issues.append(RevisionIssue(
                    'mechanics',
                    'Found double spaces',
                    section.title,
                    'low'
                ))
            
            # Repeated words
            repeated_pattern = r'\b(\w+)\s+\1\b'
            repeated_matches = re.findall(repeated_pattern, content, re.IGNORECASE)
            if repeated_matches:
                issues.append(RevisionIssue(
                    'mechanics',
                    f'Repeated words found: {", ".join(repeated_matches)}',
                    section.title,
                    'medium'
                ))
            
            # Basic punctuation
            if re.search(r'[.!?]\s*[a-z]', content):
                issues.append(RevisionIssue(
                    'mechanics',
                    'Check capitalization after punctuation',
                    section.title,
                    'medium'
                ))
        
        return issues


# ========== MAIN ESSAY ASSISTANT TASK ==========

class EssayAssistantTask(Task):
    """Main essay assistant task implementing SRSD methodology"""
    
    def __init__(self, params: Dict[str, Any]):
        super().__init__(params)
        self.essay_data = EssayData()
        self.stages = [
            PickIdeasStage(),
            OrganizeStage(),
            WriteStage(),
            ReviseStage()
        ]
        self.timeline = None
    
    def validate_params(self) -> bool:
        """Validate input parameters"""
        topic = self.params.get('topic', '').strip()
        essay_type = self.params.get('essay_type', '')
        word_count = self.params.get('word_count', 0)
        deadline = self.params.get('deadline')
        
        errors = []
        
        if not topic:
            errors.append('Topic is required')
        
        valid_types = ['opinion', 'analytical', 'comparative', 'interpretive']
        if essay_type not in valid_types:
            errors.append(f'Valid essay type is required ({", ".join(valid_types)})')
        
        if not isinstance(word_count, int) or not (100 <= word_count <= 5000):
            errors.append('Word count must be between 100 and 5000')
        
        try:
            deadline_dt = datetime.fromisoformat(deadline) if isinstance(deadline, str) else deadline
            if not isinstance(deadline_dt, datetime) or deadline_dt <= datetime.now():
                errors.append('Deadline must be in the future')
        except (ValueError, TypeError):
            errors.append('Invalid deadline format')
        
        if errors:
            raise ValueError(f'Validation failed: {", ".join(errors)}')
        
        # Set validated params to essay data
        self.essay_data.topic = topic
        self.essay_data.essay_type = essay_type
        self.essay_data.word_count = word_count
        self.essay_data.deadline = datetime.fromisoformat(deadline) if isinstance(deadline, str) else deadline
        
        return True
    
    def start(self) -> Dict[str, Any]:
        """Start the essay assistant task"""
        self.validate_params()
        self._generate_timeline()
        self.status = TaskStatus.ACTIVE
        
        print('\n🚀 STARTING ESSAY ASSISTANT')
        print('============================')
        print(f'Topic: {self.essay_data.topic}')
        print(f'Type: {self.essay_data.essay_type}')
        print(f'Target: {self.essay_data.word_count} words')
        print(f'Deadline: {self.essay_data.deadline.strftime("%Y-%m-%d")}')
        
        self._display_timeline()
        
        return self._execute_current_stage()
    
    def _generate_timeline(self):
        """Generate a timeline based on deadline"""
        now = datetime.now()
        deadline = self.essay_data.deadline
        total_days = (deadline - now).days
        
        if total_days < 1:
            raise ValueError('Not enough time to complete essay')
        
        # Distribute days across stages
        if total_days >= 7:
            stage_distribution = {
                'ideas': 1,
                'organize': 1, 
                'write': max(2, int(total_days * 0.6)),
                'revise': max(1, int(total_days * 0.3))
            }
        else:
            stage_distribution = {
                'ideas': 1,
                'organize': 1,
                'write': max(1, total_days - 2),
                'revise': 1
            }
        
        stages = [
            {'name': 'Pick Ideas', 'days': stage_distribution['ideas'], 'start_day': 1},
            {'name': 'Organize', 'days': stage_distribution['organize'], 'start_day': 1 + stage_distribution['ideas']},
            {'name': 'Write', 'days': stage_distribution['write'], 'start_day': 2 + stage_distribution['ideas']},
            {'name': 'Revise', 'days': stage_distribution['revise'], 'start_day': 2 + stage_distribution['ideas'] + stage_distribution['write']}
        ]
        
        self.timeline = {
            'total_days': total_days,
            'stages': stages
        }
    
    def _display_timeline(self):
        """Display the suggested timeline"""
        print('\n📅 SUGGESTED TIMELINE:')
        for i, stage in enumerate(self.timeline['stages'], 1):
            end_day = stage['start_day'] + stage['days'] - 1
            days_text = f"Day {stage['start_day']}" + (f"-{end_day}" if stage['days'] > 1 else "")
            print(f"   {i}. {stage['name']}: {days_text} ({stage['days']} day{'s' if stage['days'] > 1 else ''})")
    
    def _execute_current_stage(self) -> Dict[str, Any]:
        """Execute the current stage"""
        if self.current_stage >= len(self.stages):
            self.status = TaskStatus.COMPLETED
            print('\n🎉 ESSAY COMPLETED!')
            print('All stages finished successfully.')
            return {'completed': True, 'message': 'Essay task completed'}
        
        stage = self.stages[self.current_stage]
        print(f"\n▶️  Executing Stage {self.current_stage + 1}: {stage.name}")
        
        return stage.execute(self.essay_data)
    
    def next_stage(self) -> Dict[str, Any]:
        """Advance to the next stage"""
        current_stage = self.stages[self.current_stage]
        
        if not current_stage.validate(self.essay_data):
            raise ValueError(f'Cannot advance: Stage {current_stage.name} not completed properly')
        
        self.current_stage += 1
        
        if self.current_stage >= len(self.stages):
            self.status = TaskStatus.COMPLETED
            print('\n🎉 ALL STAGES COMPLETED!')
            return {'completed': True}
        
        return self._execute_current_stage()
    
    # Helper methods for interacting with specific stages
    def set_thesis(self, thesis: str) -> Dict[str, Any]:
        """Set thesis in Pick Ideas stage"""
        if self.current_stage != 0:
            raise ValueError('Can only set thesis in Pick Ideas stage')
        return self.stages[0].set_thesis(self.essay_data, thesis)
    
    def add_section_content(self, section_index: int, content: str) -> Dict[str, Any]:
        """Add content to a section in Write stage"""
        if self.current_stage != 2:
            raise ValueError('Can only add content in Write stage')
        return self.stages[2].add_content(self.essay_data, section_index, content)
    
    def get_essay_status(self) -> Dict[str, Any]:
        """Get comprehensive essay status"""
        total_words = sum(section.actual_words for section in self.essay_data.sections)
        
        return {
            'task_id': self.id,
            'status': self.status.value,
            'current_stage': self.current_stage + 1,
            'stage_name': self.stages[self.current_stage].name if self.current_stage < len(self.stages) else 'Completed',
            'progress': f"{round((self.current_stage / len(self.stages)) * 100)}%",
            'essay_data': {
                'topic': self.essay_data.topic,
                'essay_type': self.essay_data.essay_type,
                'thesis': self.essay_data.thesis,
                'target_words': self.essay_data.word_count,
                'actual_words': total_words,
                'sections': len(self.essay_data.sections),
                'completed_sections': len([s for s in self.essay_data.sections if s.completed]),
                'issues': len(self.essay_data.revision_passes),
                'high_priority_issues': len([i for i in self.essay_data.revision_passes if i.severity == 'high'])
            },
            'timeline': self.timeline
        }
    
    def get_full_essay_text(self) -> str:
        """Get the complete essay text"""
        return '\n\n'.join(
            section.content for section in self.essay_data.sections 
            if section.content.strip()
        )


# ========== TASK MANAGER ==========

class TaskManager:
    """Manages multiple tasks and their lifecycle"""
    
    def __init__(self):
        self.tasks: Dict[str, Task] = {}
    
    def create_task(self, task_type: str, params: Dict[str, Any]) -> Task:
        """Create a new task"""
        task = TaskFactory.create_task(task_type, params)
        self.tasks[task.id] = task
        return task
    
    def get_task(self, task_id: str) -> Task:
        """Get a task by ID"""
        if task_id not in self.tasks:
            raise KeyError(f'Task not found: {task_id}')
        return self.tasks[task_id]
    
    def start_task(self, task_id: str) -> Dict[str, Any]:
        """Start a task"""
        task = self.get_task(task_id)
        return task.start()
    
    def advance_task(self, task_id: str) -> Dict[str, Any]:
        """Advance a task to next stage"""
        task = self.get_task(task_id)
        if isinstance(task, EssayAssistantTask):
            return task.next_stage()
        else:
            raise ValueError('Task type does not support stage advancement')
    
    def get_task_status(self, task_id: str) -> Dict[str, Any]:
        """Get task status"""
        task = self.get_task(task_id)
        if isinstance(task, EssayAssistantTask):
            return task.get_essay_status()
        else:
            return task.save()
    
    def get_all_tasks(self) -> List[Dict[str, Any]]:
        """Get all tasks summary"""
        return [
            {
                'id': task.id,
                'type': task.type,
                'status': task.status.value,
                'created_at': task.created_at.isoformat()
            }
            for task in self.tasks.values()
        ]
    
    def delete_task(self, task_id: str) -> bool:
        """Delete a task"""
        if task_id in self.tasks:
            del self.tasks[task_id]
            return True
        return False


# ========== TESTING / DEMO CODE ==========

class EssayAssistantDemo:
    """Demo class to test the essay assistant backend"""
    
    def __init__(self):
        self.manager = TaskManager()
    
    def run_full_demo(self):
        """Run a complete essay writing demo"""
        print('🧪 ESSAY ASSISTANT BACKEND DEMO')
        print('================================\n')
        
        try:
            # Create a new essay task
            task = self.manager.create_task('essay', {
                'topic': 'The impact of social media on modern communication',
                'essay_type': 'opinion',
                'word_count': 1000,
                'deadline': (datetime.now() + timedelta(days=5)).isoformat()
            })
            
            print(f'✓ Task created with ID: {task.id}\n')
            
            # Start the task
            result = self.manager.start_task(task.id)
            print(f'Stage 1 result: {result}')
            
            # Stage 1: Set thesis
            print('\n--- SETTING THESIS ---')
            task.set_thesis('Social media has fundamentally transformed how we communicate, creating both unprecedented global connectivity and concerning barriers to authentic human interaction.')
            
            # Advance to stage 2
            result = self.manager.advance_task(task.id)
            print(f'\nStage 2 result: {result}')
            
            # Advance to stage 3
            result = self.manager.advance_task(task.id)
            print(f'\nStage 3 result: {result}')
            
            # Stage 3: Add sample content
            print('\n--- ADDING SAMPLE CONTENT ---')
            
            # Add introduction
            task.add_section_content(0, """
In the span of just two decades, social media platforms have revolutionized human communication in ways that previous generations could never have imagined. From Facebook's humble beginnings in college dormitories to TikTok's global influence on youth culture, these digital platforms have created an interconnected world where geographical boundaries seem to dissolve with each notification. However, this technological marvel comes with a complex duality that demands careful examination. Social media has fundamentally transformed how we communicate, creating both unprecedented global connectivity and concerning barriers to authentic human interaction.
            """.strip())
            
            # Add first body paragraph
            task.add_section_content(1, """
The connectivity benefits of social media are undeniably revolutionary. Platforms like Twitter and Instagram have enabled real-time communication across continents, allowing families separated by oceans to maintain daily contact and enabling grassroots movements to organize with unprecedented speed and reach. During global crises, from natural disasters to political upheavals, social media serves as both an information highway and a coordination tool. The Arab Spring demonstrations, climate change activism, and recent pandemic response efforts all demonstrate how these platforms can amplify voices that traditional media might overlook. This democratization of communication has given marginalized communities powerful tools for advocacy and has created opportunities for cultural exchange that enrich our global understanding.
            """.strip())
            
            # Add second body paragraph
            task.add_section_content(2, """
Yet alongside these remarkable benefits, social media has introduced troubling obstacles to genuine human connection. The curated nature of online profiles encourages users to present idealized versions of themselves, creating what sociologists call "performative authenticity" - a contradiction that undermines the very connection these platforms promise to foster. Research from psychology departments at major universities consistently shows increased rates of anxiety and depression among heavy social media users, particularly young people who measure their self-worth against carefully edited highlight reels of others' lives. Moreover, the algorithmic echo chambers that drive engagement often reinforce existing beliefs rather than encouraging the kind of challenging dialogue that deepens understanding and empathy.
            """.strip())
            
            # Add third body paragraph  
            task.add_section_content(3, """
The transformation of communication itself reveals perhaps the most significant impact of social media platforms. Where previous generations developed patience for delayed responses and learned to express complex ideas through extended conversation, digital natives often communicate in abbreviated bursts optimized for platform constraints. The art of nuanced discussion becomes difficult when complex issues must be reduced to character limits or competing for attention against algorithmic feeds designed to promote the most emotionally provocative content. While this efficiency has its advantages, it has also contributed to the polarization of public discourse and the decline of the contemplative, measured dialogue that democratic societies require to address challenging issues collaboratively.
            """.strip())
            
            # Add conclusion
            task.add_section_content(4, """
As we navigate this digital transformation, we must resist both uncritical enthusiasm and reflexive rejection of social media's role in modern communication. These platforms represent powerful tools that reflect human nature itself - capable of fostering both connection and division, understanding and misunderstanding, progress and regression. The key lies not in abandoning these technologies, but in developing digital literacy that helps users harness their connective power while remaining aware of their limitations. By acknowledging both the unprecedented opportunities and genuine challenges that social media presents, we can work toward a future where technology enhances rather than replaces the deep, authentic communication that human relationships require to flourish.
            """.strip())
            
            print('\n--- CONTENT ADDITION COMPLETED ---')
            
            # Advance to revision stage
            result = self.manager.advance_task(task.id)
            print(f'\nStage 4 result: {result}')
            
            # Show final status
            final_status = self.manager.get_task_status(task.id)
            print('\n--- FINAL TASK STATUS ---')
            print(json.dumps(final_status, indent=2, default=str))
            
            # Show full essay
            print('\n--- COMPLETE ESSAY ---')
            print(task.get_full_essay_text())
            
        except Exception as error:
            print(f'❌ Demo failed: {error}')
    
    def test_components(self):
        """Test individual components"""
        print('🔧 TESTING INDIVIDUAL COMPONENTS\n')
        
        # Test outline generation
        print('Testing outline generation...')
        essay_data = EssayData()
        essay_data.topic = 'Climate change effects'
        essay_data.essay_type = 'analytical'
        essay_data.word_count = 800
        essay_data.thesis = 'Climate change affects both environment and economy.'
        
        organize_stage = OrganizeStage()
        outline_result = organize_stage.execute(essay_data)
        print('✓ Outline generation successful')
        
        # Test revision passes
        print('\nTesting revision passes...')
        essay_data.sections = [
            EssaySection(
                'Introduction', 
                100, 
                content='This is a test. Climate change shows major impacts.',
                actual_words=9,
                completed=True
            ),
            EssaySection(
                'Body', 
                200,
                content='The evidence proves that warming occurs. "The data shows warming" without analysis.',
                actual_words=12,
                completed=True
            )
        ]
        
        revise_stage = ReviseStage()
        revision_result = revise_stage.execute(essay_data)
        print('✓ Revision analysis successful')
        
        print('\n✅ Component tests completed successfully!')


# ========== MAIN EXECUTION ==========

if __name__ == '__main__':
    demo = EssayAssistantDemo()
    
    # Run component tests first
    demo.test_components()
    
    # Wait a moment, then run full demo
    print('\n' + '='*50)
    print('STARTING FULL DEMO IN 2 SECONDS...')
    print('='*50)
    
    import time
    time.sleep(2)
    
    demo.run_full_demo()