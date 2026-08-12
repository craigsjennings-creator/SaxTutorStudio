from dataclasses import dataclass


@dataclass
class Note:
    """A musical note used by YourMusicTutorial."""

    pitch: str
    duration: float
    offset: float
    is_rest: bool = False

    @property
    def name(self) -> str:
        """Return the note name without the octave."""

        if self.is_rest:
            return "REST"

        return self.pitch.rstrip("0123456789-")

    @property
    def octave(self) -> int | None:
        """Return the octave number."""

        if self.is_rest:
            return None

        octave_text = self.pitch[len(self.name):]

        try:
            return int(octave_text)
        except ValueError:
            return None