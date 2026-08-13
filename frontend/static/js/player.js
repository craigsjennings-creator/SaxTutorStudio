/*
 * YourMusicTutorial - Master Playback Engine
 *
 * Web Audio's AudioContext clock is the single source of truth.
 * That same clock drives:
 *   - guide-note audio
 *   - count-in
 *   - timeline position
 *   - current-note highlighting
 *
 * This avoids audio/animation drift.
 */

let tutorialNotes = [];
let playableEvents = [];
let currentEventIndex = 0;

let audioContext = null;
let masterGain = null;

let isPlaying = false;
let isCountingIn = false;

let playbackStartAudioTime = 0;
let pausedMusicalBeats = 0;

let animationFrame = null;
let scheduledSources = [];

const BASE_BPM = 120;
const COUNT_IN_BEATS = 4;


/* =========================================================
   Audio setup
   ========================================================= */

function ensureAudioContext() {

    if (!audioContext) {

        const AudioContextClass =
            window.AudioContext ||
            window.webkitAudioContext;

        audioContext =
            new AudioContextClass();

        masterGain =
            audioContext.createGain();

        masterGain.gain.value = 0.18;

        masterGain.connect(
            audioContext.destination
        );
    }

    if (audioContext.state === "suspended") {
        audioContext.resume();
    }
}


function getSpeed() {

    const speed =
        document.getElementById("speed");

    return speed
        ? parseFloat(speed.value)
        : 1;
}


function secondsPerBeat() {

    return (
        60 /
        BASE_BPM /
        getSpeed()
    );
}


/* =========================================================
   Pitch conversion
   ========================================================= */

const NOTE_TO_SEMITONE = {
    "C": 0,
    "C#": 1,
    "D-": 1,
    "Db": 1,
    "D": 2,
    "D#": 3,
    "E-": 3,
    "Eb": 3,
    "E": 4,
    "F": 5,
    "F#": 6,
    "G-": 6,
    "Gb": 6,
    "G": 7,
    "G#": 8,
    "A-": 8,
    "Ab": 8,
    "A": 9,
    "A#": 10,
    "B-": 10,
    "Bb": 10,
    "B": 11
};


function noteNameToMidi(noteName) {

    const match =
        String(noteName).match(
            /^([A-G])([#b-]?)(-?\d+)$/
        );

    if (!match) {
        return null;
    }

    const [, letter, accidental, octaveText] =
        match;

    const pitchName =
        `${letter}${accidental}`;

    const semitone =
        NOTE_TO_SEMITONE[pitchName];

    if (semitone === undefined) {
        return null;
    }

    const octave =
        parseInt(octaveText, 10);

    return (
        (octave + 1) * 12 +
        semitone
    );
}


function midiToFrequency(midi) {

    return (
        440 *
        Math.pow(
            2,
            (midi - 69) / 12
        )
    );
}


/* =========================================================
   Guide tone
   ========================================================= */

function stopScheduledAudio() {

    scheduledSources.forEach(source => {

        try {
            source.stop();
        } catch (error) {
            // Source may already be stopped.
        }

    });

    scheduledSources = [];
}


function scheduleGuideTone(
    noteName,
    startTime,
    durationSeconds
) {

    const midi =
        noteNameToMidi(noteName);

    if (midi === null) {
        return;
    }

    const oscillator =
        audioContext.createOscillator();

    const noteGain =
        audioContext.createGain();

    oscillator.type = "triangle";

    oscillator.frequency.value =
        midiToFrequency(midi);

    /*
     * Short attack/release prevents clicks.
     */
    const attack = 0.015;
    const release = 0.04;

    noteGain.gain.setValueAtTime(
        0.0001,
        startTime
    );

    noteGain.gain.exponentialRampToValueAtTime(
        0.32,
        startTime + attack
    );

    const releaseStart =
        Math.max(
            startTime + attack,
            startTime +
            durationSeconds -
            release
        );

    noteGain.gain.setValueAtTime(
        0.32,
        releaseStart
    );

    noteGain.gain.exponentialRampToValueAtTime(
        0.0001,
        startTime +
        durationSeconds
    );

    oscillator.connect(noteGain);
    noteGain.connect(masterGain);

    oscillator.start(startTime);

    oscillator.stop(
        startTime +
        durationSeconds +
        0.02
    );

    scheduledSources.push(
        oscillator
    );
}


/* =========================================================
   Count-in click
   ========================================================= */

function scheduleCountInClick(
    when,
    strong = false
) {

    const osc =
        audioContext.createOscillator();

    const gain =
        audioContext.createGain();

    osc.type = "square";

    osc.frequency.value =
        strong ? 1200 : 850;

    gain.gain.setValueAtTime(
        strong ? 0.16 : 0.10,
        when
    );

    gain.gain.exponentialRampToValueAtTime(
        0.0001,
        when + 0.06
    );

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(when);
    osc.stop(when + 0.07);

    scheduledSources.push(osc);
}


/* =========================================================
   Timeline + UI
   ========================================================= */

function setCountInDisplay(value) {

    const overlay =
        document.getElementById(
            "count-in-overlay"
        );

    if (!overlay) {
        return;
    }

    if (value === null) {

        overlay.textContent = "";
        overlay.classList.remove(
            "visible"
        );

        return;
    }

    overlay.textContent = value;

    overlay.classList.add(
        "visible"
    );
}


function highlightEvent(index) {

    currentEventIndex = index;

    document
        .querySelectorAll(".detected-note")
        .forEach((button, buttonIndex) => {

            button.classList.toggle(
                "active",
                buttonIndex === index
            );

        });
}


function currentMusicalBeat() {

    if (!isPlaying) {
        return pausedMusicalBeats;
    }

    const elapsedSeconds =
        audioContext.currentTime -
        playbackStartAudioTime;

    return (
        elapsedSeconds /
        secondsPerBeat()
    );
}


function updateTimelineAndHighlight() {

    if (!isPlaying) {
        return;
    }

    const beat =
        currentMusicalBeat();

    if (window.setTimelineBeatPosition) {
        window.setTimelineBeatPosition(
            Math.max(0, beat)
        );
    }

    /*
     * Count-in uses negative musical beats.
     */
    if (beat < 0) {

        const countBeat =
            Math.floor(
                beat + COUNT_IN_BEATS
            );

        const number =
            Math.max(
                1,
                Math.min(
                    COUNT_IN_BEATS,
                    countBeat + 1
                )
            );

        setCountInDisplay(number);

        animationFrame =
            requestAnimationFrame(
                updateTimelineAndHighlight
            );

        return;
    }

    setCountInDisplay(null);

    let activeIndex = -1;

    for (
        let i = 0;
        i < tutorialNotes.length;
        i++
    ) {

        const note =
            tutorialNotes[i];

        const start =
            note.offset;

        const end =
            note.offset +
            note.duration;

        if (
            beat >= start &&
            beat < end
        ) {
            activeIndex = i;
            break;
        }
    }

    if (activeIndex >= 0) {
        highlightEvent(activeIndex);
    }

    const totalBeats =
        getTotalBeats();

    if (beat >= totalBeats) {

        finishPlayback();
        return;
    }

    animationFrame =
        requestAnimationFrame(
            updateTimelineAndHighlight
        );
}


function getTotalBeats() {

    if (!tutorialNotes.length) {
        return 0;
    }

    return Math.max(
        ...tutorialNotes.map(note =>
            note.offset +
            note.duration
        )
    );
}


/* =========================================================
   Scheduling
   ========================================================= */

function scheduleFromBeat(startBeat) {

    const secPerBeat =
        secondsPerBeat();

    tutorialNotes.forEach(note => {

        if (
            note.type === "rest" ||
            note.pitch === "REST"
        ) {
            return;
        }

        const noteEndBeat =
            note.offset +
            note.duration;

        if (noteEndBeat <= startBeat) {
            return;
        }

        const effectiveStartBeat =
            Math.max(
                note.offset,
                startBeat
            );

        const remainingDurationBeats =
            noteEndBeat -
            effectiveStartBeat;

        const startTime =
            playbackStartAudioTime +
            (effectiveStartBeat *
            secPerBeat);

        const durationSeconds =
            remainingDurationBeats *
            secPerBeat;

        scheduleGuideTone(
            note.pitch,
            startTime,
            durationSeconds
        );
    });
}


/* =========================================================
   Playback controls
   ========================================================= */

function startPlayback() {

    if (!tutorialNotes.length) {
        return;
    }

    if (isPlaying) {
        return;
    }

    ensureAudioContext();

    stopScheduledAudio();

    const playButton =
        document.getElementById(
            "play-button"
        );

    const secPerBeat =
        secondsPerBeat();

    /*
     * If starting from the beginning,
     * give a four-beat count-in.
     * Resuming from pause does not count in again.
     */
    const startingFresh =
        pausedMusicalBeats <= 0.0001;

    const countInDuration =
        startingFresh
            ? COUNT_IN_BEATS *
              secPerBeat
            : 0;

    isPlaying = true;
    isCountingIn = startingFresh;

    if (playButton) {
        playButton.textContent =
            "⏸ Pause";
    }

    playbackStartAudioTime =
        audioContext.currentTime +
        countInDuration -
        (pausedMusicalBeats *
        secPerBeat);

    if (startingFresh) {

        for (
            let beat = 0;
            beat < COUNT_IN_BEATS;
            beat++
        ) {

            scheduleCountInClick(
                audioContext.currentTime +
                (beat * secPerBeat),
                beat === 0
            );
        }

        /*
         * Begin the guide audio after the count-in.
         */
        scheduleFromBeat(0);

    } else {

        scheduleFromBeat(
            pausedMusicalBeats
        );
    }

    animationFrame =
        requestAnimationFrame(
            updateTimelineAndHighlight
        );
}


function pausePlayback() {

    if (!isPlaying) {
        return;
    }

    pausedMusicalBeats =
        Math.max(
            0,
            currentMusicalBeat()
        );

    isPlaying = false;
    isCountingIn = false;

    stopScheduledAudio();

    if (animationFrame) {

        cancelAnimationFrame(
            animationFrame
        );

        animationFrame = null;
    }

    setCountInDisplay(null);

    const playButton =
        document.getElementById(
            "play-button"
        );

    if (playButton) {
        playButton.textContent =
            "▶ Play";
    }
}


function finishPlayback() {

    isPlaying = false;
    isCountingIn = false;

    stopScheduledAudio();

    if (animationFrame) {

        cancelAnimationFrame(
            animationFrame
        );

        animationFrame = null;
    }

    pausedMusicalBeats = 0;

    setCountInDisplay(null);

    if (window.setTimelineBeatPosition) {
        window.setTimelineBeatPosition(0);
    }

    highlightEvent(0);

    const playButton =
        document.getElementById(
            "play-button"
        );

    if (playButton) {
        playButton.textContent =
            "▶ Play";
    }
}


function togglePlayback() {

    if (isPlaying) {
        pausePlayback();
    } else {
        startPlayback();
    }
}


function seekToEvent(index) {

    if (!tutorialNotes.length) {
        return;
    }

    pausePlayback();

    currentEventIndex =
        Math.max(
            0,
            Math.min(
                tutorialNotes.length - 1,
                index
            )
        );

    pausedMusicalBeats =
        tutorialNotes[
            currentEventIndex
        ].offset;

    highlightEvent(
        currentEventIndex
    );

    if (window.setTimelineBeatPosition) {
        window.setTimelineBeatPosition(
            pausedMusicalBeats
        );
    }
}


function previousNote() {

    seekToEvent(
        currentEventIndex - 1
    );
}


function nextNote() {

    seekToEvent(
        currentEventIndex + 1
    );
}


/* =========================================================
   Public loader
   ========================================================= */

function loadTutorialPlayer(notes) {

    tutorialNotes = notes;

    playableEvents =
        notes.filter(
            note =>
                note.type !== "rest" &&
                note.pitch !== "REST"
        );

    currentEventIndex = 0;
    pausedMusicalBeats = 0;

    stopScheduledAudio();

    if (window.setTimelineBeatPosition) {
        window.setTimelineBeatPosition(0);
    }

    highlightEvent(0);
}


/* =========================================================
   Button wiring
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        document
            .getElementById(
                "play-button"
            )
            ?.addEventListener(
                "click",
                togglePlayback
            );

        document
            .getElementById(
                "previous-note"
            )
            ?.addEventListener(
                "click",
                previousNote
            );

        document
            .getElementById(
                "next-note"
            )
            ?.addEventListener(
                "click",
                nextNote
            );

        /*
         * Changing speed while paused is immediate.
         * If changed during playback, pause first so
         * the master clock can be rescheduled cleanly.
         */
        document
            .getElementById("speed")
            ?.addEventListener(
                "change",
                () => {

                    if (isPlaying) {
                        pausePlayback();
                    }

                }
            );

    }
);


window.loadTutorialPlayer =
    loadTutorialPlayer;
