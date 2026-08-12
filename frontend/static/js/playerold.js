let tutorialNotes = [];

let currentNoteIndex = 0;

let isPlaying = false;

let playbackTimer = null;


function setTutorialNotes(notes) {

    tutorialNotes = notes;

    currentNoteIndex = 0;

    updateCurrentNote();

}


function updateCurrentNote() {

    if (!tutorialNotes.length) {
        return;
    }

    const noteData =
        tutorialNotes[currentNoteIndex];

    if (!noteData) {
        return;
    }

    const noteName = noteData.pitch;

    document
        .querySelectorAll(".detected-note")
        .forEach((button, index) => {

            button.classList.toggle(
                "active",
                index === currentNoteIndex
            );

        });

    if (
        noteName !== "REST" &&
        window.renderFingering
    ) {

        window.renderFingering(noteName);

    }

}


function getPlaybackDuration(noteData) {

    const speed =
        parseFloat(
            document.getElementById("speed").value
        );

    /*
        music21 quarterLength:

        1 = quarter note
        2 = half note
        0.5 = eighth note

        For now we assume 120 BPM.

        One quarter note = 500ms.
    */

    const quarterNoteMs = 500;

    return (
        noteData.duration *
        quarterNoteMs /
        speed
    );

}


function playNextNote() {

    if (!isPlaying) {
        return;
    }

    if (
        currentNoteIndex >=
        tutorialNotes.length
    ) {

        stopPlayback();

        currentNoteIndex = 0;

        updateCurrentNote();

        return;

    }

    const noteData =
        tutorialNotes[currentNoteIndex];

    updateCurrentNote();

    playbackTimer = setTimeout(
        () => {

            currentNoteIndex++;

            playNextNote();

        },
        getPlaybackDuration(noteData)
    );

}


function startPlayback() {

    if (!tutorialNotes.length) {
        return;
    }

    if (isPlaying) {
        return;
    }

    // If we've reached the end, start again
    if (
        currentNoteIndex >= tutorialNotes.length - 1
    ) {
        currentNoteIndex = 0;
    }

    isPlaying = true;

    document.getElementById(
        "play-button"
    ).textContent = "⏸ Pause";

    playNextNote();
}


function stopPlayback() {

    isPlaying = false;

    clearTimeout(playbackTimer);

    playbackTimer = null;

    document.getElementById(
        "play-button"
    ).textContent = "▶ Play";

}


function togglePlayback() {

    if (isPlaying) {

        stopPlayback();

    } else {

        startPlayback();

    }

}


function previousNote() {

    if (!tutorialNotes.length) {
        return;
    }

    stopPlayback();

    currentNoteIndex =
        Math.max(
            0,
            currentNoteIndex - 1
        );

    updateCurrentNote();

}


function nextNote() {

    if (!tutorialNotes.length) {
        return;
    }

    stopPlayback();

    currentNoteIndex =
        Math.min(
            tutorialNotes.length - 1,
            currentNoteIndex + 1
        );

    updateCurrentNote();

}


document.addEventListener(
    "DOMContentLoaded",
    () => {

        document
            .getElementById("play-button")
            .addEventListener(
                "click",
                togglePlayback
            );

        document
            .getElementById("previous-note")
            .addEventListener(
                "click",
                previousNote
            );

        document
            .getElementById("next-note")
            .addEventListener(
                "click",
                nextNote
            );

    }
);


window.setTutorialNotes =
    setTutorialNotes;