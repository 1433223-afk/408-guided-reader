"""Library bounded context: books, immutable source revisions, and reading positions."""

from .service import IntakeError, LibraryService

__all__ = ["IntakeError", "LibraryService"]
