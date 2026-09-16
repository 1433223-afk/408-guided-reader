from __future__ import annotations

from pathlib import Path


EXPLANATION_SKILL_PATH = Path(__file__).with_name("skills").joinpath(
    "assistant-explanation", "SKILL.md"
)


def load_explanation_skill(path: Path = EXPLANATION_SKILL_PATH) -> str:
    """Load the compact runtime skill body, excluding discovery frontmatter."""

    document = path.read_text(encoding="utf-8")
    if not document.startswith("---\n"):
        raise RuntimeError("Assistant Explanation Skill frontmatter is missing")
    parts = document.split("---", 2)
    if len(parts) != 3 or not parts[2].strip():
        raise RuntimeError("Assistant Explanation Skill body is missing")
    return parts[2].strip()
