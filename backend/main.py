from pathlib import Path
import tempfile

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import HTMLResponse

from music21 import converter, note, chord


app = FastAPI(
    title="YourMusicTutorial",
    description="Turn music into interactive instrument tutorials.",
    version="0.1.0",
)


PROJECT_ROOT = Path(__file__).resolve().parent.parent

INDEX_FILE = (
    PROJECT_ROOT
    / "frontend"
    / "templates"
    / "index.html"
)


@app.get("/", response_class=HTMLResponse)
async def home():
    """Display the YourMusicTutorial website."""

    return INDEX_FILE.read_text(encoding="utf-8")


@app.post("/api/analyse")
async def analyse_music(
    file: UploadFile = File(...),
    instrument: str = Form(...),
):
    """Analyse an uploaded MusicXML file."""

    contents = await file.read()

    with tempfile.NamedTemporaryFile(
        suffix=".musicxml",
        delete=False,
    ) as temp:

        temp.write(contents)
        temp_path = temp.name

    try:

        score = converter.parse(temp_path)

        detected_notes = []

        for element in score.flatten().notesAndRests:

            if isinstance(element, note.Note):

                detected_notes.append(
                    element.pitch.nameWithOctave
                )

            elif isinstance(element, chord.Chord):

                highest = element.pitches[-1]

                detected_notes.append(
                    highest.nameWithOctave
                )

            elif isinstance(element, note.Rest):

                detected_notes.append("REST")

        return {
            "filename": file.filename,
            "instrument": instrument,
            "note_count": len(detected_notes),
            "notes": detected_notes,
        }

    finally:

        Path(temp_path).unlink(
            missing_ok=True
        )