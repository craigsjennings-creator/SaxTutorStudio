let tutorialNotes = [];
let currentNoteIndex = 0;
let isPlaying = false;
let playbackTimer = null;


function setTutorialNotes(notes) {

    tutorialNotes = notes;
    currentNoteIndex = 0;

    updateCurrentNote();

    if (window.resetTimelineMovement) {
        window.resetTimelineMovement();
    }
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

    document
        .querySelectorAll(".detected-note")
        .forEach((button, index) => {

            button.classList.toggle(
                "active",
                index === currentNoteIndex
            );

        });
}


function getPlaybackDuration(noteData) {

    const speed =
        parseFloat(
            document.getElementById("speed").value
        );

    /*
     * Temporary tempo model:
     * 120 BPM = 500ms per quarter note.
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

        if (window.resetTimelineMovement) {
            window.resetTimelineMovement();
        }

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

    if (
        currentNoteIndex >=
        tutorialNotes.length - 1
    ) {
        currentNoteIndex = 0;
        updateCurrentNote();

        if (window.resetTimelineMovement) {
            window.resetTimelineMovement();
        }
    }

    isPlaying = true;

    document.getElementById(
        "play-button"
    ).textContent = "⏸ Pause";

    if (window.startTimelineMovement) {
        window.startTimelineMovement();
    }

    playNextNote();
}


function stopPlayback() {

    isPlaying = false;

    clearTimeout(playbackTimer);
    playbackTimer = null;

    document.getElementById(
        "play-button"
    ).textContent = "▶ Play";

    if (window.pauseTimelineMovement) {
        window.pauseTimelineMovement();
    }
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

    if (window.seekTimelineToBeat) {
        window.seekTimelineToBeat(
            tutorialNotes[currentNoteIndex].offset
        );
    }
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

    if (window.seekTimelineToBeat) {
        window.seekTimelineToBeat(
            tutorialNotes[currentNoteIndex].offset
        );
    }
}


document.addEventListener(
    "DOMContentLoaded",
    () => {

        document
            .getElementById("play-button")
            ?.addEventListener(
                "click",
                togglePlayback
            );

        document
            .getElementById("previous-note")
            ?.addEventListener(
                "click",
                previousNote
            );

        document
            .getElementById("next-note")
            ?.addEventListener(
                "click",
                nextNote
            );

    }
);


/*
 * New explicit player entry point.
 * This avoids the old setTutorialNotes naming collision.
 */
window.loadTutorialPlayer = setTutorialNotes;
