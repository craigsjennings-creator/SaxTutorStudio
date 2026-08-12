from dataclasses import dataclass, field

from .note import Note


@dataclass
class Song:
    """A musical piece being processed by YourMusicTutorial."""

    title: str
    notes: list[Note] = field(default_factory=list)

    @property
    def note_count(self) -> int:
        """Return the number of musical events."""

        return len(self.notes)

    @property
    def duration(self) -> float:
        """Return the approximate duration in beats."""

        if not self.notes:
            return 0.0

        return max(
            note.offset + note.duration
            for note in self.notes
        )