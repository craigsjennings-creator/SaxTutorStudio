from dataclasses import dataclass
from pathlib import Path

from music21 import converter, note, chord


@dataclass
class MusicNote:
    """A single musical note used by SaxTutor Studio."""

    pitch: str
    duration: float
    offset: float
    is_rest: bool = False


def load_musicxml(filename: str | Path) -> list[MusicNote]:
    """
    Load a MusicXML file and convert it into SaxTutor notes.

    For the first version we read the first musical part.
    """

    score = converter.parse(str(filename))

    if not score.parts:
        raise ValueError("The MusicXML file contains no musical parts.")

    part = score.parts[0]

    notes: list[MusicNote] = []

    for element in part.flatten().notesAndRests:

        if isinstance(element, note.Rest):
            notes.append(
                MusicNote(
                    pitch="Rest",
                    duration=float(element.duration.quarterLength),
                    offset=float(element.offset),
                    is_rest=True,
                )
            )

        elif isinstance(element, note.Note):
            notes.append(
                MusicNote(
                    pitch=element.pitch.nameWithOctave,
                    duration=float(element.duration.quarterLength),
                    offset=float(element.offset),
                )
            )

        elif isinstance(element, chord.Chord):
            # For now, use the highest note of a chord.
            # Later we can decide how chords should be handled.
            highest_note = chord.Chord(element).pitches[-1]

            notes.append(
                MusicNote(
                    pitch=highest_note.nameWithOctave,
                    duration=float(element.duration.quarterLength),
                    offset=float(element.offset),
                )
            )

    return notes