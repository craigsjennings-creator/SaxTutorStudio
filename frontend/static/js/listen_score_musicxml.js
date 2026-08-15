/*
 * YourMusicTutorial - Score MusicXML v1
 *
 * Loads a real MusicXML file in the browser, extracts:
 *   pitch
 *   start offset
 *   duration
 *   rests
 *
 * Then scores a simulated performance using:
 *   real Iowa WAV pitch detection
 *   timing offsets
 *   duration/hold controls
 *
 * Tempo:
 * MusicXML files without an explicit tempo are scored at 120 BPM,
 * matching the current tutorial player's BASE_BPM.
 */

const SAMPLE_BASE =
    "/static/audio/saxophone/alto/samples/mf/";

const SAMPLE_NOTES = [
    "Db3", "D3", "Eb3", "E3", "F3", "Gb3",
    "G3", "Ab3", "A3", "Bb3", "B3",
    "C4", "Db4", "D4", "Eb4", "E4", "F4",
    "Gb4", "G4", "Ab4", "A4", "Bb4", "B4",
    "C5", "Db5", "D5", "Eb5", "E5", "F5",
    "Gb5", "G5", "Ab5"
];

const DEFAULT_BPM = 120;

let audioContext = null;
let loadedPhrase = [];

let currentResults = [];
let recommendedLoop = null;

let loadedMusicXMLText = "";
let loadedMusicXMLName = "tutorial.musicxml";

let activeCoachLoop = null;
let attemptHistory = [];

let loopUndoStack = [];


const PRACTICE_PIXELS_PER_SECOND = 160;

let practiceTimelineDragging = false;
let practiceTimelineDragStartX = 0;
let practiceTimelineScrollStart = 0;

let scorecardLoopDrawActive = false;
let scorecardLoopDrawStartIndex = null;
let scorecardLoopDrawCurrentIndex = null;
let scorecardLoopPointerX = 0;
let scorecardLoopPointerY = 0;
let scorecardLoopAutoScrollDirection = 0;
let scorecardLoopAutoScrollFrame = null;
let scorecardLoopAutoScrollLastTime = 0;

const SCORECARD_LOOP_EDGE_ZONE = 80;
const SCORECARD_LOOP_SCROLL_PX_PER_SECOND = 380;


function ensureAudioContext() {
    if (!audioContext) {
        const AudioContextClass =
            window.AudioContext ||
            window.webkitAudioContext;

        audioContext =
            new AudioContextClass();
    }

    if (audioContext.state === "suspended") {
        audioContext.resume();
    }
}


function alterToAccidental(alter) {
    if (alter === 1) return "#";
    if (alter === -1) return "b";
    return "";
}


function parseMusicXML(text) {

    const parser =
        new DOMParser();

    const xml =
        parser.parseFromString(
            text,
            "application/xml"
        );

    const parserError =
        xml.querySelector(
            "parsererror"
        );

    if (parserError) {
        throw new Error(
            "The MusicXML file could not be parsed."
        );
    }

    const part =
        xml.querySelector("part");

    if (!part) {
        throw new Error(
            "No musical part was found in the MusicXML file."
        );
    }

    let divisions = 1;
    let offsetBeats = 0;
    let bpm = DEFAULT_BPM;

    /*
     * Read first explicit tempo if present.
     */
    const soundTempo =
        xml.querySelector(
            "sound[tempo]"
        );

    if (soundTempo) {
        const value =
            parseFloat(
                soundTempo.getAttribute(
                    "tempo"
                )
            );

        if (
            Number.isFinite(value) &&
            value > 0
        ) {
            bpm = value;
        }
    }

    const metronomePerMinute =
        xml.querySelector(
            "metronome per-minute"
        );

    if (
        metronomePerMinute &&
        !soundTempo
    ) {
        const value =
            parseFloat(
                metronomePerMinute.textContent
            );

        if (
            Number.isFinite(value) &&
            value > 0
        ) {
            bpm = value;
        }
    }

    const events = [];

    const measures =
        Array.from(
            part.querySelectorAll(
                ":scope > measure"
            )
        );

    measures.forEach(measure => {

        const divisionsNode =
            measure.querySelector(
                "attributes > divisions"
            );

        if (divisionsNode) {
            const parsed =
                parseFloat(
                    divisionsNode.textContent
                );

            if (
                Number.isFinite(parsed) &&
                parsed > 0
            ) {
                divisions =
                    parsed;
            }
        }

        const notes =
            Array.from(
                measure.children
            ).filter(
                node =>
                    node.tagName ===
                    "note"
            );

        notes.forEach(noteNode => {

            /*
             * Chords reuse the previous note start.
             * This v1 scoring lab is monophonic, so skip extra chord tones.
             */
            if (
                noteNode.querySelector(
                    ":scope > chord"
                )
            ) {
                return;
            }

            const durationNode =
                noteNode.querySelector(
                    ":scope > duration"
                );

            if (!durationNode) {
                return;
            }

            const durationDivisions =
                parseFloat(
                    durationNode.textContent
                );

            if (
                !Number.isFinite(
                    durationDivisions
                )
            ) {
                return;
            }

            const durationBeats =
                durationDivisions /
                divisions;

            const rest =
                Boolean(
                    noteNode.querySelector(
                        ":scope > rest"
                    )
                );

            if (rest) {

                events.push({
                    type: "rest",
                    pitch: "REST",
                    offsetBeats,
                    durationBeats
                });

                offsetBeats +=
                    durationBeats;

                return;
            }

            const step =
                noteNode.querySelector(
                    "pitch > step"
                )?.textContent;

            const octave =
                noteNode.querySelector(
                    "pitch > octave"
                )?.textContent;

            const alter =
                parseInt(
                    noteNode.querySelector(
                        "pitch > alter"
                    )?.textContent ??
                    "0",
                    10
                );

            if (
                !step ||
                octave === undefined
            ) {
                return;
            }

            const pitch =
                `${step}${alterToAccidental(
                    alter
                )}${octave}`;

            events.push({
                type: "note",
                pitch,
                offsetBeats,
                durationBeats
            });

            offsetBeats +=
                durationBeats;
        });
    });

    const secondsPerBeat =
        60 / bpm;

    const playable =
        events
            .filter(
                event =>
                    event.type ===
                    "note"
            )
            .map(
                event => ({
                    pitch:
                        normaliseToSampleName(
                            event.pitch
                        ),
                    originalPitch:
                        event.pitch,
                    start:
                        event.offsetBeats *
                        secondsPerBeat,
                    duration:
                        event.durationBeats *
                        secondsPerBeat,
                    startBeats:
                        event.offsetBeats,
                    durationBeats:
                        event.durationBeats
                })
            );

    if (!playable.length) {
        throw new Error(
            "No playable notes were found."
        );
    }

    return {
        bpm,
        playable,
        eventCount:
            events.length
    };
}


function normaliseToSampleName(
    noteName
) {

    const match =
        String(noteName).match(
            /^([A-G])([#b]?)(-?\d+)$/
        );

    if (!match) {
        return noteName;
    }

    const [
        ,
        letter,
        accidental,
        octave
    ] = match;

    const sharpToFlat = {
        "C#": "Db",
        "D#": "Eb",
        "F#": "Gb",
        "G#": "Ab",
        "A#": "Bb"
    };

    let pitchClass =
        `${letter}${accidental}`;

    if (
        sharpToFlat[
            pitchClass
        ]
    ) {
        pitchClass =
            sharpToFlat[
                pitchClass
            ];
    }

    return (
        pitchClass +
        octave
    );
}



function beatRangeToPlayableIndexes(
    startBeat,
    endBeat
) {

    if (!loadedPhrase.length) {
        return null;
    }

    let startIndex = 0;
    let endIndex =
        loadedPhrase.length - 1;

    let bestStart = Infinity;
    let bestEnd = Infinity;

    loadedPhrase.forEach(
        (note, index) => {

            const startDistance =
                Math.abs(
                    note.startBeats -
                    startBeat
                );

            const endDistance =
                Math.abs(
                    (
                        note.startBeats +
                        note.durationBeats
                    ) -
                    endBeat
                );

            if (startDistance < bestStart) {
                bestStart =
                    startDistance;
                startIndex =
                    index;
            }

            if (endDistance < bestEnd) {
                bestEnd =
                    endDistance;
                endIndex =
                    index;
            }
        }
    );

    if (endIndex < startIndex) {
        [startIndex, endIndex] =
            [endIndex, startIndex];
    }

    return {
        startIndex,
        endIndex
    };
}


function applyActiveCoachLoopToUI() {

    if (!activeCoachLoop) {
        return;
    }

    document
        .querySelectorAll(
            ".phrase-row"
        )
        .forEach(
            (row, index) => {

                const inside =
                    index >=
                        activeCoachLoop.startIndex &&
                    index <=
                        activeCoachLoop.endIndex;

                row.style.display =
                    inside
                        ? ""
                        : "none";
            }
        );
}


function currentScoredPhrase() {

    if (!activeCoachLoop) {
        return loadedPhrase.map(
            (note, index) => ({
                note,
                originalIndex:
                    index
            })
        );
    }

    return loadedPhrase
        .map(
            (note, index) => ({
                note,
                originalIndex:
                    index
            })
        )
        .filter(
            item =>
                item.originalIndex >=
                    activeCoachLoop.startIndex &&
                item.originalIndex <=
                    activeCoachLoop.endIndex
        );
}


function saveCoachingState() {

    if (activeCoachLoop) {
        localStorage.setItem(
            "ymtCoachActiveLoop",
            JSON.stringify(
                activeCoachLoop
            )
        );
    }

    localStorage.setItem(
        "ymtCoachAttemptHistory",
        JSON.stringify(
            attemptHistory
        )
    );
}



function loopKey(loop) {

    if (!loop) {
        return "whole-song";
    }

    return `${loop.startIndex}:${loop.endIndex}`;
}


function loopRelationship(
    previousLoop,
    currentLoop
) {

    if (
        !previousLoop &&
        !currentLoop
    ) {
        return {
            type: "same",
            addedBefore: 0,
            addedAfter: 0,
            removedBefore: 0,
            removedAfter: 0
        };
    }

    if (
        !previousLoop &&
        currentLoop
    ) {
        return {
            type: "focused",
            addedBefore: 0,
            addedAfter: 0,
            removedBefore: 0,
            removedAfter: 0
        };
    }

    if (
        previousLoop &&
        !currentLoop
    ) {
        return {
            type: "whole-song",
            addedBefore: 0,
            addedAfter: 0,
            removedBefore: 0,
            removedAfter: 0
        };
    }

    const same =
        previousLoop.startIndex ===
            currentLoop.startIndex &&
        previousLoop.endIndex ===
            currentLoop.endIndex;

    if (same) {
        return {
            type: "same",
            addedBefore: 0,
            addedAfter: 0,
            removedBefore: 0,
            removedAfter: 0
        };
    }

    const containsPrevious =
        currentLoop.startIndex <=
            previousLoop.startIndex &&
        currentLoop.endIndex >=
            previousLoop.endIndex;

    if (containsPrevious) {

        return {
            type: "expanded",

            addedBefore:
                previousLoop.startIndex -
                currentLoop.startIndex,

            addedAfter:
                currentLoop.endIndex -
                previousLoop.endIndex,

            removedBefore: 0,
            removedAfter: 0
        };
    }

    const insidePrevious =
        currentLoop.startIndex >=
            previousLoop.startIndex &&
        currentLoop.endIndex <=
            previousLoop.endIndex;

    if (insidePrevious) {

        return {
            type: "shrunk",

            addedBefore: 0,
            addedAfter: 0,

            removedBefore:
                currentLoop.startIndex -
                previousLoop.startIndex,

            removedAfter:
                previousLoop.endIndex -
                currentLoop.endIndex
        };
    }

    const overlaps =
        Math.max(
            previousLoop.startIndex,
            currentLoop.startIndex
        ) <=
        Math.min(
            previousLoop.endIndex,
            currentLoop.endIndex
        );

    return {
        type:
            overlaps
                ? "shifted"
                : "different",
        addedBefore: 0,
        addedAfter: 0,
        removedBefore: 0,
        removedAfter: 0
    };
}


function summaryFromPerNote(
    perNote
) {

    if (!perNote.length) {
        return null;
    }

    const correct =
        perNote.filter(
            item =>
                item.correct
        );

    const noteAccuracy =
        Math.round(
            correct.length /
            perNote.length *
            100
        );

    const tuning =
        correct.length
            ? Math.round(
                correct.reduce(
                    (sum, item) =>
                        sum +
                        (
                            item.tuningScore ??
                            0
                        ),
                    0
                ) /
                correct.length
            )
            : 0;

    const timing =
        Math.round(
            perNote.reduce(
                (sum, item) =>
                    sum +
                    item.timingScore,
                0
            ) /
                perNote.length
        );

    const duration =
        Math.round(
            perNote.reduce(
                (sum, item) =>
                    sum +
                    item.durationScore,
                0
            ) /
                perNote.length
        );

    const overall =
        Math.round(
            noteAccuracy * 0.50 +
            tuning * 0.15 +
            timing * 0.20 +
            duration * 0.15
        );

    return {
        overall,
        noteAccuracy,
        tuning,
        timing,
        duration
    };
}


function overlappingIndexes(
    firstLoop,
    secondLoop
) {

    if (
        !firstLoop ||
        !secondLoop
    ) {
        return null;
    }

    const start =
        Math.max(
            firstLoop.startIndex,
            secondLoop.startIndex
        );

    const end =
        Math.min(
            firstLoop.endIndex,
            secondLoop.endIndex
        );

    if (start > end) {
        return [];
    }

    const indexes = [];

    for (
        let index = start;
        index <= end;
        index++
    ) {
        indexes.push(index);
    }

    return indexes;
}


function filterAttemptToIndexes(
    attempt,
    indexes
) {

    if (!attempt?.perNote) {
        return [];
    }

    if (indexes === null) {
        return attempt.perNote;
    }

    const wanted =
        new Set(indexes);

    return attempt.perNote.filter(
        item =>
            wanted.has(
                item.index
            )
    );
}


function deltaText(
    current,
    previous
) {

    const delta =
        current -
        previous;

    return {
        delta,
        text:
            `${previous}% → ${current}% (${
                delta > 0
                    ? "+"
                    : ""
            }${delta})`,
        className:
            delta > 0
                ? "delta-positive"
                : delta < 0
                    ? "delta-negative"
                    : "delta-neutral"
    };
}


function renderAttemptComparison() {

    const banner =
        document.getElementById(
            "attempt-comparison-banner"
        );

    const note =
        document.getElementById(
            "attempt-comparison-note"
        );

    if (
        !banner ||
        attemptHistory.length < 2
    ) {
        return;
    }

    const current =
        attemptHistory[
            attemptHistory.length - 1
        ];

    const previous =
        attemptHistory[
            attemptHistory.length - 2
        ];

    const relationship =
        loopRelationship(
            previous.loop,
            current.loop
        );

    let previousSummary = {
        overall:
            previous.overall,
        noteAccuracy:
            previous.noteAccuracy,
        tuning:
            previous.tuning,
        timing:
            previous.timing,
        duration:
            previous.duration
    };

    let currentSummary = {
        overall:
            current.overall,
        noteAccuracy:
            current.noteAccuracy,
        tuning:
            current.tuning,
        timing:
            current.timing,
        duration:
            current.duration
    };

    let explanation = "";

    if (
        relationship.type ===
        "same"
    ) {

        explanation =
            "Same practice loop, so this is a direct attempt-to-attempt comparison.";

    } else if (
        relationship.type ===
        "expanded"
    ) {

        const overlap =
            overlappingIndexes(
                previous.loop,
                current.loop
            );

        const previousOverlap =
            summaryFromPerNote(
                filterAttemptToIndexes(
                    previous,
                    overlap
                )
            );

        const currentOverlap =
            summaryFromPerNote(
                filterAttemptToIndexes(
                    current,
                    overlap
                )
            );

        if (
            previousOverlap &&
            currentOverlap
        ) {
            previousSummary =
                previousOverlap;

            currentSummary =
                currentOverlap;
        }

        const added =
            relationship.addedBefore +
            relationship.addedAfter;

        explanation =
            `You expanded the loop by ${added} note${
                added === 1 ? "" : "s"
            }`;

        if (
            relationship.addedBefore &&
            relationship.addedAfter
        ) {
            explanation +=
                ` (${relationship.addedBefore} before and ${relationship.addedAfter} after).`;
        } else if (
            relationship.addedBefore
        ) {
            explanation +=
                ` before the previous section.`;
        } else {
            explanation +=
                ` after the previous section.`;
        }

        explanation +=
            " The comparison below measures only the notes shared by both loops, so a harder expanded loop is not unfairly treated as regression.";

        const addedIndexes = [];

        if (current.loop) {

            for (
                let index =
                    current.loop.startIndex;
                index <=
                    current.loop.endIndex;
                index++
            ) {

                if (
                    !overlap.includes(
                        index
                    )
                ) {
                    addedIndexes.push(
                        index
                    );
                }
            }
        }

        const addedSummary =
            summaryFromPerNote(
                filterAttemptToIndexes(
                    current,
                    addedIndexes
                )
            );

        if (addedSummary) {
            explanation +=
                ` The newly added notes scored ${addedSummary.overall}% overall.`;
        }

    } else if (
        relationship.type ===
        "shrunk"
    ) {

        explanation =
            "You made the practice loop smaller. This comparison uses the latest scores as shown, but it is a different-sized challenge.";

    } else if (
        relationship.type ===
        "shifted"
    ) {

        explanation =
            "You shifted the practice range. The loops overlap, but this is not a like-for-like attempt.";

    } else if (
        relationship.type ===
        "focused"
    ) {

        explanation =
            "You moved from whole-song scoring into a focused practice loop. This begins a more targeted coaching phase.";

    } else {

        explanation =
            "This is a different practice section, so it starts a new comparison context.";
    }

    const overallDelta =
        deltaText(
            currentSummary.overall,
            previousSummary.overall
        );

    const noteDelta =
        deltaText(
            currentSummary.noteAccuracy,
            previousSummary.noteAccuracy
        );

    const tuningDelta =
        deltaText(
            currentSummary.tuning,
            previousSummary.tuning
        );

    const timingDelta =
        deltaText(
            currentSummary.timing,
            previousSummary.timing
        );

    const durationDelta =
        deltaText(
            currentSummary.duration,
            previousSummary.duration
        );

    const metrics = [
        ["compare-overall", overallDelta],
        ["compare-notes", noteDelta],
        ["compare-tuning", tuningDelta],
        ["compare-timing", timingDelta],
        ["compare-duration", durationDelta]
    ];

    metrics.forEach(
        ([id, data]) => {

            const element =
                document.getElementById(
                    id
                );

            if (element) {
                element.textContent =
                    data.text;

                element.className =
                    `attempt-comparison-value ${data.className}`;
            }
        }
    );

    let coaching = "";

    if (
        relationship.type ===
        "same" ||
        relationship.type ===
        "expanded"
    ) {

        const deltas = [
            ["note accuracy", noteDelta.delta],
            ["tuning", tuningDelta.delta],
            ["timing", timingDelta.delta],
            ["duration", durationDelta.delta]
        ];

        const best =
            [...deltas].sort(
                (a, b) =>
                    b[1] - a[1]
            )[0];

        const worst =
            [...deltas].sort(
                (a, b) =>
                    a[1] - b[1]
            )[0];

        if (
            overallDelta.delta > 0
        ) {
            coaching +=
                `You improved by ${overallDelta.delta} points on the comparable section. `;
        } else if (
            overallDelta.delta < 0
        ) {
            coaching +=
                `The comparable section dipped by ${Math.abs(
                    overallDelta.delta
                )} points this attempt. `;
        } else {
            coaching +=
                "The comparable section held the same overall score. ";
        }

        if (best[1] > 0) {
            coaching +=
                `Biggest improvement: ${best[0]} (+${best[1]}). `;
        }

        if (worst[1] < -3) {
            coaching +=
                `Watch ${worst[0]}, which fell by ${Math.abs(
                    worst[1]
                )} points.`;
        }
    }

    banner.textContent =
        explanation;

    note.textContent =
        coaching;
}


function renderProgress() {

    const history =
        document.getElementById(
            "progress-history"
        );

    if (!history) {
        return;
    }

    history.innerHTML = "";

    attemptHistory.forEach(
        (attempt, index) => {

            const pill =
                document.createElement(
                    "div"
                );

            pill.className =
                "attempt-pill";

            pill.textContent =
                `Attempt ${index + 1}: ${attempt.overall}%`;

            history.appendChild(
                pill
            );
        }
    );

    const latest =
        attemptHistory[
            attemptHistory.length - 1
        ];

    const message =
        document.getElementById(
            "progress-message"
        );

    const actions =
        document.getElementById(
            "expand-actions"
        );

    if (!latest) {
        actions?.classList.remove(
            "show"
        );
        return;
    }

    if (latest.overall >= 85) {

        message.textContent =
            "Great improvement. This loop is strong enough to expand.";

        actions?.classList.add(
            "show"
        );

    } else {

        message.textContent =
            `Current loop score: ${latest.overall}%. Keep practising this section before expanding it.`;

        actions?.classList.remove(
            "show"
        );
    }
}


function expandActiveLoop(
    before,
    after
) {

    if (!activeCoachLoop) {
        return;
    }

    pushLoopUndoState();

    activeCoachLoop.startIndex =
        Math.max(
            0,
            activeCoachLoop.startIndex -
            before
        );

    activeCoachLoop.endIndex =
        Math.min(
            loadedPhrase.length - 1,
            activeCoachLoop.endIndex +
            after
        );

    applyActiveCoachLoopToUI();

    const start =
        loadedPhrase[
            activeCoachLoop.startIndex
        ];

    const end =
        loadedPhrase[
            activeCoachLoop.endIndex
        ];

    recommendedLoop = {
        startIndex:
            activeCoachLoop.startIndex,
        endIndex:
            activeCoachLoop.endIndex,
        startNote:
            start.pitch,
        endNote:
            end.pitch,
        issue:
            "Expanded practice",
        speed:
            "75%",
        severity:
            20
    };

    updatePracticeLoopRecommendation(
        currentResults.length
            ? currentResults
            : []
    );

    document.getElementById(
        "practice-loop-message"
    ).textContent =
        `Expanded practice loop: notes ${activeCoachLoop.startIndex + 1}–${activeCoachLoop.endIndex + 1}. Score this larger section when ready.`;

    saveCoachingState();
    renderProgress();
}


async function restoreCoachingFromTutorial() {

    const params =
        new URLSearchParams(
            window.location.search
        );

    if (
        params.get(
            "fromTutorial"
        ) !== "1"
    ) {
        return;
    }

    const xml =
        localStorage.getItem(
            "ymtCurrentMusicXML"
        );

    if (!xml) {
        return;
    }

    loadedMusicXMLText =
        xml;

    loadedMusicXMLName =
        localStorage.getItem(
            "ymtCurrentMusicXMLName"
        ) ||
        "tutorial.musicxml";

    const parsed =
        parseMusicXML(
            xml
        );

    loadedPhrase =
        parsed.playable;

    buildPerformanceUI();

    document.getElementById(
        "performance-card"
    ).style.display =
        "block";

    const loopActive =
        localStorage.getItem(
            "ymtCoachLoopActive"
        ) === "1";

    if (loopActive) {

        const startBeat =
            parseFloat(
                localStorage.getItem(
                    "ymtCoachLoopStartBeat"
                )
            );

        const endBeat =
            parseFloat(
                localStorage.getItem(
                    "ymtCoachLoopEndBeat"
                )
            );

        const indexes =
            beatRangeToPlayableIndexes(
                startBeat,
                endBeat
            );

        if (indexes) {
            activeCoachLoop =
                indexes;
        }

    } else {

        const storedLoop =
            localStorage.getItem(
                "ymtCoachActiveLoop"
            );

        if (storedLoop) {
            try {
                activeCoachLoop =
                    JSON.parse(
                        storedLoop
                    );
            } catch (error) {
                activeCoachLoop =
                    null;
            }
        }
    }

    try {
        attemptHistory =
            JSON.parse(
                localStorage.getItem(
                    "ymtCoachAttemptHistory"
                ) ||
                "[]"
            );
    } catch (error) {
    }

    applyActiveCoachLoopToUI();
    renderPracticeTimeline();
    renderProgress();
    renderAttemptComparison();

    document.getElementById(
        "load-status"
    ).textContent =
        activeCoachLoop
            ? `Loaded ${loadedMusicXMLName}. Coaching is focused on notes ${activeCoachLoop.startIndex + 1}–${activeCoachLoop.endIndex + 1}.`
            : `Loaded ${loadedMusicXMLName} automatically from the tutorial.`;

    window.history.replaceState(
        {},
        document.title,
        window.location.pathname
    );
}


async function loadChosenFile() {

    const input =
        document.getElementById(
            "musicxml-file"
        );

    const status =
        document.getElementById(
            "load-status"
        );

    const file =
        input.files?.[0];

    if (!file) {
        status.textContent =
            "Choose a MusicXML file first.";
        return;
    }

    try {

        status.textContent =
            `Loading ${file.name}...`;

        const text =
            await file.text();

        loadedMusicXMLText =
            text;

        loadedMusicXMLName =
            file.name ||
            "tutorial.musicxml";

        const parsed =
            parseMusicXML(
                text
            );

        loadedPhrase =
            parsed.playable;

        buildPerformanceUI();

        renderPracticeTimeline();

        document.getElementById(
            "performance-card"
        ).style.display =
            "block";

        document.getElementById(
            "summary"
        ).style.display =
            "none";

        status.textContent =
            `Loaded ${file.name}: ${parsed.playable.length} playable notes at ${parsed.bpm} BPM. Rests are preserved in the timing.`;

    } catch (error) {

        console.error(error);

        status.textContent =
            `Error: ${error.message}`;
    }
}


function buildPerformanceUI() {

    const grid =
        document.getElementById(
            "phrase-grid"
        );

    grid.innerHTML = "";

    loadedPhrase.forEach(
        (item, index) => {

            const maxDuration =
                Math.max(
                    0.5,
                    item.duration *
                    1.75
                );

            const row =
                document.createElement(
                    "div"
                );

            row.className =
                "phrase-row";

            row.innerHTML = `
                <div class="num">
                    ${index + 1}
                </div>

                <div class="expected-note">
                    ${item.pitch}
                </div>

                <div class="meta-cell meta">
                    start ${item.start.toFixed(2)}s
                    <br>
                    hold ${item.duration.toFixed(2)}s
                </div>

                <div>
                    <span class="control-label">
                        Played sample
                    </span>

                    <select
                        class="played-select"
                        data-index="${index}"
                    ></select>
                </div>

                <div class="timing-cell">
                    <span class="control-label">
                        Timing offset (s)
                    </span>

                    <div class="slider-control">
                        <input
                            type="range"
                            class="timing-slider"
                            data-index="${index}"
                            min="-0.60"
                            max="0.60"
                            step="0.01"
                            value="0"
                        >

                        <input
                            type="number"
                            class="timing-number"
                            data-index="${index}"
                            min="-0.60"
                            max="0.60"
                            step="0.01"
                            value="0"
                        >
                    </div>
                </div>

                <div class="duration-cell">
                    <span class="control-label">
                        Held duration (s)
                    </span>

                    <div class="slider-control">
                        <input
                            type="range"
                            class="duration-slider"
                            data-index="${index}"
                            min="0.05"
                            max="${maxDuration.toFixed(2)}"
                            step="0.01"
                            value="${item.duration.toFixed(2)}"
                        >

                        <input
                            type="number"
                            class="duration-number"
                            data-index="${index}"
                            min="0.05"
                            max="${maxDuration.toFixed(2)}"
                            step="0.01"
                            value="${item.duration.toFixed(2)}"
                        >
                    </div>
                </div>
            `;

            const select =
                row.querySelector(
                    ".played-select"
                );

            SAMPLE_NOTES.forEach(note => {

                const option =
                    document.createElement(
                        "option"
                    );

                option.value = note;
                option.textContent =
                    `${note}.wav`;

                select.appendChild(
                    option
                );
            });

            if (
                SAMPLE_NOTES.includes(
                    item.pitch
                )
            ) {
                select.value =
                    item.pitch;
            }

            grid.appendChild(
                row
            );
        }
    );

    wirePairs(
        ".timing-slider",
        ".timing-number"
    );

    wirePairs(
        ".duration-slider",
        ".duration-number"
    );
}


function wirePairs(
    sliderSelector,
    numberSelector
) {

    document
        .querySelectorAll(
            sliderSelector
        )
        .forEach(slider => {

            slider.addEventListener(
                "input",
                () => {

                    const number =
                        document.querySelector(
                            `${numberSelector}[data-index="${slider.dataset.index}"]`
                        );

                    if (number) {
                        number.value =
                            slider.value;
                    }
                }
            );
        });

    document
        .querySelectorAll(
            numberSelector
        )
        .forEach(number => {

            number.addEventListener(
                "input",
                () => {

                    const slider =
                        document.querySelector(
                            `${sliderSelector}[data-index="${number.dataset.index}"]`
                        );

                    if (slider) {
                        slider.value =
                            number.value;
                    }
                }
            );
        });
}


async function loadSample(
    noteName
) {

    ensureAudioContext();

    const response =
        await fetch(
            `${SAMPLE_BASE}${noteName}.wav`
        );

    if (!response.ok) {
        throw new Error(
            `Could not load ${noteName}.wav`
        );
    }

    const bytes =
        await response.arrayBuffer();

    return await audioContext.decodeAudioData(
        bytes
    );
}


function toMono(buffer) {

    if (
        buffer.numberOfChannels ===
        1
    ) {
        return buffer.getChannelData(
            0
        );
    }

    const mono =
        new Float32Array(
            buffer.length
        );

    for (
        let channel = 0;
        channel <
        buffer.numberOfChannels;
        channel++
    ) {

        const data =
            buffer.getChannelData(
                channel
            );

        for (
            let i = 0;
            i < buffer.length;
            i++
        ) {

            mono[i] +=
                data[i] /
                buffer.numberOfChannels;
        }
    }

    return mono;
}


function rms(frame) {
    let sum = 0;

    for (
        let i = 0;
        i < frame.length;
        i++
    ) {
        sum +=
            frame[i] *
            frame[i];
    }

    return Math.sqrt(
        sum /
        frame.length
    );
}


function yinPitch(
    frame,
    sampleRate
) {

    const minFrequency = 90;
    const maxFrequency = 1000;

    const minTau =
        Math.max(
            2,
            Math.floor(
                sampleRate /
                maxFrequency
            )
        );

    const maxTau =
        Math.min(
            Math.floor(
                sampleRate /
                minFrequency
            ),
            Math.floor(
                frame.length /
                2
            )
        );

    const difference =
        new Float64Array(
            maxTau + 1
        );

    for (
        let tau = 1;
        tau <= maxTau;
        tau++
    ) {

        let sum = 0;

        const limit =
            frame.length -
            tau;

        for (
            let i = 0;
            i < limit;
            i++
        ) {

            const delta =
                frame[i] -
                frame[
                    i + tau
                ];

            sum +=
                delta *
                delta;
        }

        difference[tau] =
            sum;
    }

    const cmnd =
        new Float64Array(
            maxTau + 1
        );

    cmnd[0] = 1;

    let runningSum = 0;

    for (
        let tau = 1;
        tau <= maxTau;
        tau++
    ) {

        runningSum +=
            difference[tau];

        cmnd[tau] =
            runningSum === 0
                ? 1
                : (
                    difference[tau] *
                    tau /
                    runningSum
                );
    }

    let tauEstimate = -1;
    const threshold = 0.15;

    for (
        let tau = minTau;
        tau < maxTau;
        tau++
    ) {

        if (
            cmnd[tau] <
            threshold
        ) {

            while (
                tau + 1 <=
                maxTau &&
                cmnd[tau + 1] <
                cmnd[tau]
            ) {
                tau++;
            }

            tauEstimate = tau;
            break;
        }
    }

    if (tauEstimate < 0) {

        let bestValue =
            Infinity;

        for (
            let tau = minTau;
            tau <= maxTau;
            tau++
        ) {

            if (
                cmnd[tau] <
                bestValue
            ) {
                bestValue =
                    cmnd[tau];

                tauEstimate =
                    tau;
            }
        }
    }

    if (
        tauEstimate <= 0
    ) {
        return null;
    }

    let betterTau =
        tauEstimate;

    if (
        tauEstimate >
        minTau &&
        tauEstimate <
        maxTau
    ) {

        const left =
            cmnd[
                tauEstimate - 1
            ];

        const centre =
            cmnd[
                tauEstimate
            ];

        const right =
            cmnd[
                tauEstimate + 1
            ];

        const denominator =
            (
                2 * centre
            ) -
            left -
            right;

        if (
            Math.abs(
                denominator
            ) >
            1e-12
        ) {

            betterTau =
                tauEstimate +
                0.5 *
                (
                    right -
                    left
                ) /
                denominator;
        }
    }

    return {
        frequency:
            sampleRate /
            betterTau,

        confidence:
            Math.max(
                0,
                Math.min(
                    1,
                    1 -
                    cmnd[
                        tauEstimate
                    ]
                )
            )
    };
}


function median(values) {

    const sorted =
        [...values].sort(
            (a, b) =>
                a - b
        );

    const middle =
        Math.floor(
            sorted.length /
            2
        );

    if (
        sorted.length %
        2 === 0
    ) {
        return (
            sorted[
                middle - 1
            ] +
            sorted[
                middle
            ]
        ) / 2;
    }

    return sorted[
        middle
    ];
}


function analyseBuffer(buffer) {

    const mono =
        toMono(buffer);

    const sampleRate =
        buffer.sampleRate;

    const frameSize =
        4096;

    const fractions = [
        0.18,
        0.28,
        0.38,
        0.48,
        0.58,
        0.68
    ];

    const results = [];

    fractions.forEach(
        fraction => {

            const centre =
                Math.floor(
                    mono.length *
                    fraction
                );

            const start =
                Math.max(
                    0,
                    Math.min(
                        mono.length -
                        frameSize,
                        centre -
                        Math.floor(
                            frameSize /
                            2
                        )
                    )
                );

            const frame =
                mono.subarray(
                    start,
                    start +
                    frameSize
                );

            if (
                rms(frame) <
                0.003
            ) {
                return;
            }

            const result =
                yinPitch(
                    frame,
                    sampleRate
                );

            if (result) {
                results.push(
                    result
                );
            }
        }
    );

    if (!results.length) {
        throw new Error(
            "No stable pitch detected."
        );
    }

    const roughMedian =
        median(
            results.map(
                result =>
                    result.frequency
            )
        );

    const filtered =
        results.filter(
            result => {

                const ratio =
                    result.frequency /
                    roughMedian;

                return (
                    ratio > 0.80 &&
                    ratio < 1.20
                );
            }
        );

    const usable =
        filtered.length
            ? filtered
            : results;

    return {
        frequency:
            median(
                usable.map(
                    result =>
                        result.frequency
                )
            ),

        confidence:
            median(
                usable.map(
                    result =>
                        result.confidence
                )
            )
    };
}


function frequencyToMidi(
    frequency
) {
    return (
        69 +
        12 *
        Math.log2(
            frequency /
            440
        )
    );
}


function midiToNoteName(
    midi
) {

    const names = [
        "C", "Db", "D", "Eb",
        "E", "F", "Gb", "G",
        "Ab", "A", "Bb", "B"
    ];

    const rounded =
        Math.round(
            midi
        );

    const pitchClass =
        (
            (
                rounded %
                12
            ) +
            12
        ) % 12;

    const octave =
        Math.floor(
            rounded /
            12
        ) - 1;

    return (
        names[
            pitchClass
        ] +
        octave
    );
}


function noteNameToMidi(
    noteName
) {

    const match =
        String(noteName).match(
            /^([A-G])([b#]?)(-?\d+)$/
        );

    if (!match) {
        return null;
    }

    const [
        ,
        letter,
        accidental,
        octaveText
    ] = match;

    const base = {
        C: 0,
        D: 2,
        E: 4,
        F: 5,
        G: 7,
        A: 9,
        B: 11
    }[letter];

    let semitone =
        base;

    if (
        accidental === "#"
    ) {
        semitone++;
    }

    if (
        accidental === "b"
    ) {
        semitone--;
    }

    return (
        (
            parseInt(
                octaveText,
                10
            ) + 1
        ) *
        12 +
        semitone
    );
}


function midiToFrequency(
    midi
) {
    return (
        440 *
        Math.pow(
            2,
            (
                midi -
                69
            ) /
            12
        )
    );
}


function scorePitch(
    expectedNote,
    analysis
) {

    const expectedMidi =
        noteNameToMidi(
            expectedNote
        );

    const detectedMidi =
        Math.round(
            frequencyToMidi(
                analysis.frequency
            )
        );

    const detectedNote =
        midiToNoteName(
            detectedMidi
        );

    const correct =
        detectedMidi ===
        expectedMidi;

    const expectedFrequency =
        midiToFrequency(
            expectedMidi
        );

    const cents =
        1200 *
        Math.log2(
            analysis.frequency /
            expectedFrequency
        );

    let tuningScore =
        null;

    if (correct) {

        const abs =
            Math.abs(
                cents
            );

        tuningScore =
            abs <= 5
                ? 100
                : Math.max(
                    0,
                    Math.round(
                        100 -
                        (
                            abs -
                            5
                        ) *
                        1.6
                    )
                );
    }

    return {
        detectedNote,
        correct,
        cents,
        tuningScore,
        confidence:
            analysis.confidence
    };
}


function scoreTiming(error) {

    const abs =
        Math.abs(
            error
        );

    if (abs <= 0.05) {
        return {
            score: 100,
            label: "Excellent"
        };
    }

    if (abs <= 0.12) {
        return {
            score:
                Math.round(
                    100 -
                    (
                        (
                            abs -
                            0.05
                        ) /
                        0.07
                    ) *
                    12
                ),
            label: "Good"
        };
    }

    if (abs <= 0.22) {
        return {
            score:
                Math.round(
                    88 -
                    (
                        (
                            abs -
                            0.12
                        ) /
                        0.10
                    ) *
                    23
                ),
            label: "Fair"
        };
    }

    if (abs <= 0.35) {
        return {
            score:
                Math.round(
                    65 -
                    (
                        (
                            abs -
                            0.22
                        ) /
                        0.13
                    ) *
                    35
                ),
            label:
                error < 0
                    ? "Early"
                    : "Late"
        };
    }

    return {
        score:
            Math.max(
                0,
                Math.round(
                    30 -
                    (
                        abs -
                        0.35
                    ) *
                    60
                )
            ),
        label:
            error < 0
                ? "Very early"
                : "Very late"
    };
}


function scoreDuration(
    expected,
    actual
) {

    const difference =
        actual -
        expected;

    const relativeError =
        Math.abs(
            difference
        ) /
        expected;

    if (
        relativeError <=
        0.05
    ) {
        return {
            score: 100,
            label: "Excellent"
        };
    }

    if (
        relativeError <=
        0.12
    ) {
        return {
            score:
                Math.round(
                    100 -
                    (
                        (
                            relativeError -
                            0.05
                        ) /
                        0.07
                    ) *
                    12
                ),
            label: "Good"
        };
    }

    if (
        relativeError <=
        0.22
    ) {
        return {
            score:
                Math.round(
                    88 -
                    (
                        (
                            relativeError -
                            0.12
                        ) /
                        0.10
                    ) *
                    23
                ),
            label: "Fair"
        };
    }

    if (
        relativeError <=
        0.35
    ) {
        return {
            score:
                Math.round(
                    65 -
                    (
                        (
                            relativeError -
                            0.22
                        ) /
                        0.13
                    ) *
                    35
                ),
            label:
                difference < 0
                    ? "Short"
                    : "Long"
        };
    }

    return {
        score:
            Math.max(
                0,
                Math.round(
                    30 -
                    (
                        relativeError -
                        0.35
                    ) *
                    55
                )
            ),
        label:
            difference < 0
                ? "Much too short"
                : "Much too long"
    };
}


function scoreClass(
    value
) {
    if (value >= 85) {
        return "good";
    }

    if (value >= 60) {
        return "warn";
    }

    return "bad";
}


async function analysePerformance() {

    const status =
        document.getElementById(
            "analysis-status"
        );

    const button =
        document.getElementById(
            "analyse-performance"
        );

    const played =
        Array.from(
            document.querySelectorAll(
                ".played-select"
            )
        );

    const timingInputs =
        Array.from(
            document.querySelectorAll(
                ".timing-number"
            )
        );

    const durationInputs =
        Array.from(
            document.querySelectorAll(
                ".duration-number"
            )
        );

    button.disabled =
        true;

    button.textContent =
        "Analysing...";

    const results = [];

    try {

        const phraseToScore =
            currentScoredPhrase();

        for (
            let localIndex = 0;
            localIndex < phraseToScore.length;
            localIndex++
        ) {

            const originalIndex =
                phraseToScore[
                    localIndex
                ].originalIndex;

            const expected =
                phraseToScore[
                    localIndex
                ].note;

            const playedNote =
                played[
                    originalIndex
                ].value;

            const timingError =
                parseFloat(
                    timingInputs[
                        originalIndex
                    ].value
                ) || 0;

            const heldDuration =
                Math.max(
                    0.05,
                    parseFloat(
                        durationInputs[
                            originalIndex
                        ].value
                    ) ||
                    expected.duration
                );

            status.textContent =
                `Analysing ${localIndex + 1}/${phraseToScore.length}: ${playedNote}.wav`;

            const buffer =
                await loadSample(
                    playedNote
                );

            await new Promise(
                resolve =>
                    requestAnimationFrame(
                        resolve
                    )
            );

            const pitchAnalysis =
                analyseBuffer(
                    buffer
                );

            results.push({
                index:
                    originalIndex,
                expected,
                timingError,
                heldDuration,
                ...scorePitch(
                    expected.pitch,
                    pitchAnalysis
                ),
                timing:
                    scoreTiming(
                        timingError
                    ),
                duration:
                    scoreDuration(
                        expected.duration,
                        heldDuration
                    )
            });
        }

        renderResults(
            results
        );

        const summary =
            calculateSummary(
                results
            );

        attemptHistory.push({
            overall:
                summary.overall,
            noteAccuracy:
                summary.noteAccuracy,
            tuning:
                summary.tuning,
            timing:
                summary.timing,
            duration:
                summary.duration,

            loop:
                activeCoachLoop
                    ? {
                        ...activeCoachLoop
                    }
                    : null,

            perNote:
                results.map(
                    result => ({
                        index:
                            result.index,
                        correct:
                            result.correct,
                        tuningScore:
                            result.tuningScore,
                        timingScore:
                            result.timing.score,
                        durationScore:
                            result.duration.score
                    })
                )
        });

        saveCoachingState();
        renderProgress();
        renderAttemptComparison();

        status.textContent =
            "Performance analysis complete.";

    } catch (error) {

        console.error(
            error
        );

        status.textContent =
            `Error: ${error.message}`;

    } finally {

        button.disabled =
            false;

        button.textContent =
            "Analyse Full Performance";
    }
}


function calculateSummary(
    results
) {

    const correct =
        results.filter(
            result =>
                result.correct
        );

    const noteAccuracy =
        Math.round(
            correct.length /
            results.length *
            100
        );

    const tuning =
        correct.length
            ? Math.round(
                correct.reduce(
                    (
                        sum,
                        result
                    ) =>
                        sum +
                        (
                            result.tuningScore ??
                            0
                        ),
                    0
                ) /
                correct.length
            )
            : 0;

    const timing =
        Math.round(
            results.reduce(
                (
                    sum,
                    result
                ) =>
                    sum +
                    result.timing.score,
                0
            ) /
                results.length
        );

    const duration =
        Math.round(
            results.reduce(
                (
                    sum,
                    result
                ) =>
                    sum +
                    result.duration.score,
                0
            ) /
                results.length
        );

    const overall =
        Math.round(
            noteAccuracy *
                0.50 +
            tuning *
                0.15 +
            timing *
                0.20 +
            duration *
                0.15
        );

    return {
        noteAccuracy,
        tuning,
        timing,
        duration,
        overall
    };
}


function weaknessFor(
    result
) {

    const issues = [];

    if (!result.correct) {
        issues.push(
            "Wrong note"
        );
    }

    if (
        result.correct &&
        (
            result.tuningScore ??
            100
        ) <
        70
    ) {
        issues.push(
            result.cents < 0
                ? "Flat"
                : "Sharp"
        );
    }

    if (
        result.timing.score <
        70
    ) {
        issues.push(
            result.timing.label
        );
    }

    if (
        result.duration.score <
        70
    ) {
        issues.push(
            `Duration: ${result.duration.label}`
        );
    }

    return issues.length
        ? issues.join(", ")
        : "Good";
}




function renderPracticeTimeline() {

    const track =
        document.getElementById(
            "practice-timeline-track"
        );

    const viewport =
        document.getElementById(
            "practice-timeline-viewport"
        );

    if (
        !track ||
        !viewport ||
        !loadedPhrase.length
    ) {
        return;
    }

    track.innerHTML = "";

    const totalSeconds =
        Math.max(
            ...loadedPhrase.map(
                note =>
                    note.start +
                    note.duration
            )
        );

    /*
     * Add padding so the first/last notes can reach the fixed playhead.
     */
    const sidePadding =
        Math.max(
            260,
            viewport.clientWidth /
            2
        );

    const contentWidth =
        sidePadding * 2 +
        totalSeconds *
        PRACTICE_PIXELS_PER_SECOND;

    track.style.width =
        `${contentWidth}px`;

    loadedPhrase.forEach(
        (note, index) => {

            const left =
                sidePadding +
                note.start *
                PRACTICE_PIXELS_PER_SECOND;

            const width =
                Math.max(
                    8,
                    note.duration *
                    PRACTICE_PIXELS_PER_SECOND -
                    6
                );

            const label =
                document.createElement(
                    "div"
                );

            label.className =
                "practice-note";

            label.dataset.noteIndex =
                String(index);

            label.textContent =
                note.pitch;

            label.style.left =
                `${left}px`;

            track.appendChild(
                label
            );

            const bar =
                document.createElement(
                    "div"
                );

            bar.className =
                "practice-bar";

            bar.dataset.noteIndex =
                String(index);

            bar.style.left =
                `${left}px`;

            bar.style.width =
                `${width}px`;

            track.appendChild(
                bar
            );
        }
    );

    if (recommendedLoop) {
        highlightRecommendedLoopOnTimeline();
    }

    /*
     * Start at the beginning with note 1 near the playhead.
     */
    viewport.scrollLeft =
        Math.max(
            0,
            sidePadding -
            viewport.clientWidth /
            2
        );
}


function highlightRecommendedLoopOnTimeline() {

    const track =
        document.getElementById(
            "practice-timeline-track"
        );

    const viewport =
        document.getElementById(
            "practice-timeline-viewport"
        );

    if (
        !track ||
        !viewport ||
        !recommendedLoop ||
        !loadedPhrase.length
    ) {
        return;
    }

    track
        .querySelectorAll(
            ".practice-loop-shade"
        )
        .forEach(
            element =>
                element.remove()
        );

    track
        .querySelectorAll(
            ".practice-bar"
        )
        .forEach(bar =>
            bar.classList.remove(
                "loop-range"
            )
        );

    const startNote =
        loadedPhrase[
            recommendedLoop.startIndex
        ];

    const endNote =
        loadedPhrase[
            recommendedLoop.endIndex
        ];

    if (!startNote || !endNote) {
        return;
    }

    const sidePadding =
        Math.max(
            260,
            viewport.clientWidth /
            2
        );

    const startX =
        sidePadding +
        startNote.start *
        PRACTICE_PIXELS_PER_SECOND;

    const endX =
        sidePadding +
        (
            endNote.start +
            endNote.duration
        ) *
        PRACTICE_PIXELS_PER_SECOND;

    const shade =
        document.createElement(
            "div"
        );

    shade.className =
        "practice-loop-shade";

    shade.style.left =
        `${startX}px`;

    shade.style.width =
        `${Math.max(
            10,
            endX - startX
        )}px`;

    track.appendChild(
        shade
    );

    for (
        let index =
            recommendedLoop.startIndex;
        index <=
            recommendedLoop.endIndex;
        index++
    ) {

        track
            .querySelector(
                `.practice-bar[data-note-index="${index}"]`
            )
            ?.classList.add(
                "loop-range"
            );
    }

    /*
     * Centre the recommended loop under the fixed playhead.
     */
    const loopCentre =
        (
            startX +
            endX
        ) /
        2;

    viewport.scrollLeft =
        Math.max(
            0,
            loopCentre -
            viewport.clientWidth /
            2
        );
}



function scorecardSelectableIndexFromPoint(
    clientX,
    clientY
) {

    const element =
        document.elementFromPoint(
            clientX,
            clientY
        );

    const selectable =
        element?.closest(
            ".practice-note[data-note-index], .practice-bar[data-note-index]"
        );

    if (!selectable) {
        return null;
    }

    const index =
        parseInt(
            selectable.dataset.noteIndex ?? "",
            10
        );

    return Number.isFinite(index)
        ? index
        : null;
}


function clearScorecardLoopPreview() {

    document
        .querySelectorAll(
            ".practice-bar.loop-preview"
        )
        .forEach(
            bar =>
                bar.classList.remove(
                    "loop-preview"
                )
        );

    document
        .querySelectorAll(
            ".practice-loop-shade.loop-preview"
        )
        .forEach(
            shade =>
                shade.remove()
        );
}


function previewScorecardLoopRange(
    startIndex,
    endIndex
) {

    clearScorecardLoopPreview();

    if (
        startIndex === null ||
        endIndex === null
    ) {
        return;
    }

    const minIndex =
        Math.min(
            startIndex,
            endIndex
        );

    const maxIndex =
        Math.max(
            startIndex,
            endIndex
        );

    for (
        let index = minIndex;
        index <= maxIndex;
        index++
    ) {
        document
            .querySelector(
                `.practice-bar[data-note-index="${index}"]`
            )
            ?.classList.add(
                "loop-preview"
            );
    }
}


function nearestScorecardNoteByX(
    clientX
) {

    const notes =
        Array.from(
            document.querySelectorAll(
                ".practice-note[data-note-index]"
            )
        );

    if (!notes.length) {
        return null;
    }

    let nearestIndex = null;
    let nearestDistance = Infinity;

    notes.forEach(note => {

        const rect =
            note.getBoundingClientRect();

        const centre =
            rect.left +
            rect.width / 2;

        const distance =
            Math.abs(
                centre -
                clientX
            );

        if (
            distance <
            nearestDistance
        ) {

            const index =
                parseInt(
                    note.dataset.noteIndex,
                    10
                );

            if (Number.isFinite(index)) {
                nearestDistance =
                    distance;
                nearestIndex =
                    index;
            }
        }
    });

    return nearestIndex;
}


function updateScorecardLoopDrawSelection() {

    if (!scorecardLoopDrawActive) {
        return;
    }

    let index =
        scorecardSelectableIndexFromPoint(
            scorecardLoopPointerX,
            scorecardLoopPointerY
        );

    if (index === null) {
        index =
            nearestScorecardNoteByX(
                scorecardLoopPointerX
            );
    }

    if (index === null) {
        return;
    }

    if (
        index !==
        scorecardLoopDrawCurrentIndex
    ) {

        scorecardLoopDrawCurrentIndex =
            index;

        previewScorecardLoopRange(
            scorecardLoopDrawStartIndex,
            scorecardLoopDrawCurrentIndex
        );
    }
}


function stopScorecardLoopAutoScroll() {

    scorecardLoopAutoScrollDirection = 0;

    if (scorecardLoopAutoScrollFrame) {
        cancelAnimationFrame(
            scorecardLoopAutoScrollFrame
        );

        scorecardLoopAutoScrollFrame =
            null;
    }

    scorecardLoopAutoScrollLastTime = 0;
}


function runScorecardLoopAutoScroll(
    now
) {

    if (
        !scorecardLoopDrawActive ||
        scorecardLoopAutoScrollDirection === 0
    ) {
        stopScorecardLoopAutoScroll();
        return;
    }

    const viewport =
        document.getElementById(
            "practice-timeline-viewport"
        );

    if (!viewport) {
        stopScorecardLoopAutoScroll();
        return;
    }

    if (!scorecardLoopAutoScrollLastTime) {
        scorecardLoopAutoScrollLastTime =
            now;
    }

    const deltaSeconds =
        Math.min(
            0.05,
            (
                now -
                scorecardLoopAutoScrollLastTime
            ) /
            1000
        );

    scorecardLoopAutoScrollLastTime =
        now;

    viewport.scrollLeft +=
        scorecardLoopAutoScrollDirection *
        SCORECARD_LOOP_SCROLL_PX_PER_SECOND *
        deltaSeconds;

    updateScorecardLoopDrawSelection();

    scorecardLoopAutoScrollFrame =
        requestAnimationFrame(
            runScorecardLoopAutoScroll
        );
}


function updateScorecardLoopAutoScroll() {

    const viewport =
        document.getElementById(
            "practice-timeline-viewport"
        );

    if (
        !viewport ||
        !scorecardLoopDrawActive
    ) {
        stopScorecardLoopAutoScroll();
        return;
    }

    const rect =
        viewport.getBoundingClientRect();

    let direction = 0;

    if (
        scorecardLoopPointerX <=
        rect.left +
        SCORECARD_LOOP_EDGE_ZONE
    ) {
        direction = -1;

    } else if (
        scorecardLoopPointerX >=
        rect.right -
        SCORECARD_LOOP_EDGE_ZONE
    ) {
        direction = 1;
    }

    if (
        direction ===
        scorecardLoopAutoScrollDirection
    ) {
        return;
    }

    stopScorecardLoopAutoScroll();

    scorecardLoopAutoScrollDirection =
        direction;

    if (direction !== 0) {
        scorecardLoopAutoScrollFrame =
            requestAnimationFrame(
                runScorecardLoopAutoScroll
            );
    }
}


function cloneLoopState(
    loop
) {

    return loop
        ? {
            startIndex:
                loop.startIndex,
            endIndex:
                loop.endIndex
        }
        : null;
}


function pushLoopUndoState() {

    loopUndoStack.push({
        activeCoachLoop:
            cloneLoopState(
                activeCoachLoop
            ),

        recommendedLoop:
            recommendedLoop
                ? {
                    ...recommendedLoop
                }
                : null,

        attemptHistory:
            attemptHistory.map(
                attempt => ({
                    ...attempt
                })
            )
    });

    /*
     * Keep a modest history rather than allowing it
     * to grow forever.
     */
    if (
        loopUndoStack.length >
        20
    ) {
        loopUndoStack.shift();
    }

    updateUndoButton();
}


function updateUndoButton() {

    const button =
        document.getElementById(
            "undo-loop"
        );

    if (button) {
        button.disabled =
            loopUndoStack.length === 0;
    }
}


function undoLoopChange() {

    const previous =
        loopUndoStack.pop();

    if (!previous) {
        return;
    }

    activeCoachLoop =
        previous.activeCoachLoop;

    recommendedLoop =
        previous.recommendedLoop;

    attemptHistory =
        previous.attemptHistory;

    if (activeCoachLoop) {

        const start =
            loadedPhrase[
                activeCoachLoop.startIndex
            ];

        const end =
            loadedPhrase[
                activeCoachLoop.endIndex
            ];

        document.getElementById(
            "loop-start-note"
        ).textContent =
            `${activeCoachLoop.startIndex + 1}. ${start.pitch}`;

        document.getElementById(
            "loop-end-note"
        ).textContent =
            `${activeCoachLoop.endIndex + 1}. ${end.pitch}`;
    }

    applyActiveCoachLoopToUI();

    if (recommendedLoop) {
        highlightRecommendedLoopOnTimeline();
    }

    saveCoachingState();
    renderProgress();
    updateUndoButton();

    document.getElementById(
        "practice-loop-message"
    ).textContent =
        activeCoachLoop
            ? `Loop restored to notes ${activeCoachLoop.startIndex + 1}–${activeCoachLoop.endIndex + 1}.`
            : "Previous loop selection restored.";
}


function beginScorecardLoopDraw(
    event,
    noteIndex
) {

    const viewport =
        document.getElementById(
            "practice-timeline-viewport"
        );

    if (!viewport) {
        return;
    }

    scorecardLoopDrawActive = true;

    scorecardLoopDrawStartIndex =
        noteIndex;

    scorecardLoopDrawCurrentIndex =
        noteIndex;

    scorecardLoopPointerX =
        event.clientX;

    scorecardLoopPointerY =
        event.clientY;

    viewport.classList.add(
        "loop-drawing"
    );

    try {
        viewport.setPointerCapture(
            event.pointerId
        );
    } catch (error) {
        // Optional.
    }

    previewScorecardLoopRange(
        noteIndex,
        noteIndex
    );

    event.preventDefault();
}


function moveScorecardLoopDraw(
    event
) {

    if (!scorecardLoopDrawActive) {
        return;
    }

    scorecardLoopPointerX =
        event.clientX;

    scorecardLoopPointerY =
        event.clientY;

    updateScorecardLoopDrawSelection();
    updateScorecardLoopAutoScroll();

    event.preventDefault();
}


function endScorecardLoopDraw(
    event
) {

    if (!scorecardLoopDrawActive) {
        return;
    }

    const viewport =
        document.getElementById(
            "practice-timeline-viewport"
        );

    stopScorecardLoopAutoScroll();

    viewport?.classList.remove(
        "loop-drawing"
    );

    if (
        scorecardLoopDrawStartIndex !== null &&
        scorecardLoopDrawCurrentIndex !== null
    ) {

        let startIndex =
            Math.min(
                scorecardLoopDrawStartIndex,
                scorecardLoopDrawCurrentIndex
            );

        let endIndex =
            Math.max(
                scorecardLoopDrawStartIndex,
                scorecardLoopDrawCurrentIndex
            );

        /*
         * Save the current loop first so the learner can undo
         * an accidental expansion.
         */
        pushLoopUndoState();

        /*
         * Drawing on the scorecard ADDS to the current loop.
         * Example:
         * existing 1–3 + drag on note 4 => 1–4
         *
         * This makes it natural to grow a recommended loop
         * one or several notes at a time.
         */
        if (activeCoachLoop) {

            startIndex =
                Math.min(
                    startIndex,
                    activeCoachLoop.startIndex
                );

            endIndex =
                Math.max(
                    endIndex,
                    activeCoachLoop.endIndex
                );
        }

        activeCoachLoop = {
            startIndex,
            endIndex
        };

        const start =
            loadedPhrase[
                startIndex
            ];

        const end =
            loadedPhrase[
                endIndex
            ];

        recommendedLoop = {
            startIndex,
            endIndex,
            startNote:
                start.pitch,
            endNote:
                end.pitch,
            issue:
                "Custom selection",
            speed:
                "75%",
            severity:
                20
        };

        document.getElementById(
            "loop-start-note"
        ).textContent =
            `${startIndex + 1}. ${start.pitch}`;

        document.getElementById(
            "loop-end-note"
        ).textContent =
            `${endIndex + 1}. ${end.pitch}`;

        document.getElementById(
            "loop-speed"
        ).textContent =
            "75%";

        document.getElementById(
            "loop-issue"
        ).textContent =
            "Custom selection";

        document.getElementById(
            "practice-loop-badge"
        ).textContent =
            "Your loop";

        document.getElementById(
            "practice-loop-message"
        ).textContent =
            `Practice loop updated: notes ${startIndex + 1}–${endIndex + 1}. Analyse again to score only this section.`;

        applyActiveCoachLoopToUI();
        highlightRecommendedLoopOnTimeline();
        saveCoachingState();
        renderProgress();
    }

    clearScorecardLoopPreview();

    scorecardLoopDrawActive = false;
    scorecardLoopDrawStartIndex = null;
    scorecardLoopDrawCurrentIndex = null;

    try {
        viewport?.releasePointerCapture(
            event.pointerId
        );
    } catch (error) {
        // Ignore.
    }

    event.preventDefault();
}


function beginPracticeTimelineDrag(
    event
) {

    const viewport =
        document.getElementById(
            "practice-timeline-viewport"
        );

    if (!viewport) {
        return;
    }

    const selectable =
        event.target.closest(
            ".practice-note[data-note-index], .practice-bar[data-note-index]"
        );

    if (selectable) {

        const noteIndex =
            parseInt(
                selectable.dataset.noteIndex,
                10
            );

        if (Number.isFinite(noteIndex)) {
            beginScorecardLoopDraw(
                event,
                noteIndex
            );
            return;
        }
    }

    practiceTimelineDragging =
        true;

    practiceTimelineDragStartX =
        event.clientX;

    practiceTimelineScrollStart =
        viewport.scrollLeft;

    viewport.classList.add(
        "dragging"
    );

    try {
        viewport.setPointerCapture(
            event.pointerId
        );
    } catch (error) {
        // Optional.
    }
}


function movePracticeTimelineDrag(
    event
) {

    if (scorecardLoopDrawActive) {
        moveScorecardLoopDraw(
            event
        );
        return;
    }

    if (!practiceTimelineDragging) {
        return;
    }

    const viewport =
        document.getElementById(
            "practice-timeline-viewport"
        );

    if (!viewport) {
        return;
    }

    const delta =
        event.clientX -
        practiceTimelineDragStartX;

    viewport.scrollLeft =
        practiceTimelineScrollStart -
        delta;

    event.preventDefault();
}


function endPracticeTimelineDrag(
    event
) {

    if (scorecardLoopDrawActive) {
        endScorecardLoopDraw(
            event
        );
        return;
    }

    if (!practiceTimelineDragging) {
        return;
    }

    const viewport =
        document.getElementById(
            "practice-timeline-viewport"
        );

    practiceTimelineDragging =
        false;

    viewport?.classList.remove(
        "dragging"
    );

    try {
        viewport?.releasePointerCapture(
            event.pointerId
        );
    } catch (error) {
        // Ignore.
    }
}


function issueSeverity(result) {

    /*
     * Higher = more urgent.
     * Wrong notes matter most, then timing/duration.
     * Tuning only contributes when the note itself was correct.
     */
    let severity = 0;

    if (!result.correct) {
        severity += 100;
    }

    if (
        result.correct &&
        result.tuningScore !== null
    ) {
        severity +=
            Math.max(
                0,
                70 -
                result.tuningScore
            );
    }

    severity +=
        Math.max(
            0,
            75 -
            result.timing.score
        ) *
        0.8;

    severity +=
        Math.max(
            0,
            75 -
            result.duration.score
        ) *
        0.7;

    return severity;
}


function dominantIssue(results) {

    let wrong = 0;
    let timing = 0;
    let duration = 0;
    let tuning = 0;

    results.forEach(result => {

        if (!result.correct) {
            wrong++;
        }

        if (result.timing.score < 70) {
            timing++;
        }

        if (result.duration.score < 70) {
            duration++;
        }

        if (
            result.correct &&
            result.tuningScore !== null &&
            result.tuningScore < 70
        ) {
            tuning++;
        }
    });

    const ranked = [
        ["Wrong notes", wrong],
        ["Timing", timing],
        ["Duration", duration],
        ["Tuning", tuning]
    ].sort(
        (a, b) =>
            b[1] - a[1]
    );

    return ranked[0][1] > 0
        ? ranked[0][0]
        : "General polish";
}


function recommendedSpeedFor(segment) {

    const averageSeverity =
        segment.reduce(
            (sum, result) =>
                sum +
                issueSeverity(result),
            0
        ) /
        segment.length;

    if (averageSeverity >= 75) {
        return "50%";
    }

    if (averageSeverity >= 35) {
        return "75%";
    }

    return "100%";
}


function findRecommendedLoop(results) {

    if (!results.length) {
        return null;
    }

    /*
     * A note is considered genuinely weak when its combined
     * severity is high enough to merit focused practice.
     */
    const weakThreshold = 35;

    const weakFlags =
        results.map(
            result =>
                issueSeverity(result) >=
                weakThreshold
        );

    /*
     * Find the longest contiguous weak run.
     * If the learner gets 8 notes wrong in a row, this returns
     * all 8 rather than always collapsing to a 3-note loop.
     */
    let bestRunStart = -1;
    let bestRunEnd = -1;
    let currentStart = -1;

    for (
        let index = 0;
        index <= weakFlags.length;
        index++
    ) {

        const weak =
            index < weakFlags.length
                ? weakFlags[index]
                : false;

        if (
            weak &&
            currentStart < 0
        ) {
            currentStart =
                index;
        }

        if (
            !weak &&
            currentStart >= 0
        ) {

            const end =
                index - 1;

            if (
                bestRunStart < 0 ||
                (
                    end -
                    currentStart
                ) >
                (
                    bestRunEnd -
                    bestRunStart
                )
            ) {
                bestRunStart =
                    currentStart;

                bestRunEnd =
                    end;
            }

            currentStart = -1;
        }
    }

    /*
     * If there is a real weak run, use it.
     * Pad very short runs to at least 3 notes when possible,
     * but do not shrink longer runs.
     */
    if (
        bestRunStart >= 0
    ) {

        let startIndex =
            bestRunStart;

        let endIndex =
            bestRunEnd;

        while (
            (
                endIndex -
                startIndex +
                1
            ) < 3 &&
            (
                startIndex > 0 ||
                endIndex <
                    results.length - 1
            )
        ) {

            if (startIndex > 0) {
                startIndex--;
            }

            if (
                (
                    endIndex -
                    startIndex +
                    1
                ) < 3 &&
                endIndex <
                    results.length - 1
            ) {
                endIndex++;
            }
        }

        const segment =
            results.slice(
                startIndex,
                endIndex + 1
            );

        return {
            startIndex,
            endIndex,
            startNote:
                results[
                    startIndex
                ].expected.pitch,
            endNote:
                results[
                    endIndex
                ].expected.pitch,
            issue:
                dominantIssue(
                    segment
                ),
            speed:
                recommendedSpeedFor(
                    segment
                ),
            severity:
                segment.reduce(
                    (sum, result) =>
                        sum +
                        issueSeverity(
                            result
                        ),
                    0
                ) /
                segment.length
        };
    }

    /*
     * No major weak run: choose the worst compact 3-note
     * section as a polish recommendation.
     */
    const size =
        Math.min(
            3,
            results.length
        );

    let bestStart = 0;
    let bestScore = -Infinity;

    for (
        let start = 0;
        start <=
            results.length -
            size;
        start++
    ) {

        const segment =
            results.slice(
                start,
                start + size
            );

        const average =
            segment.reduce(
                (sum, result) =>
                    sum +
                    issueSeverity(
                        result
                    ),
                0
            ) /
            size;

        if (average > bestScore) {
            bestScore =
                average;
            bestStart =
                start;
        }
    }

    const segment =
        results.slice(
            bestStart,
            bestStart + size
        );

    return {
        startIndex:
            bestStart,
        endIndex:
            bestStart +
            size -
            1,
        startNote:
            results[
                bestStart
            ].expected.pitch,
        endNote:
            results[
                bestStart +
                size -
                1
            ].expected.pitch,
        issue:
            dominantIssue(
                segment
            ),
        speed:
            recommendedSpeedFor(
                segment
            ),
        severity:
            bestScore
    };
}

function updatePracticeLoopRecommendation(
    results
) {

    recommendedLoop =
        findRecommendedLoop(
            results
        );

    if (!recommendedLoop) {
        return;
    }

    highlightRecommendedLoopOnTimeline();

    document.getElementById(
        "loop-start-note"
    ).textContent =
        `${recommendedLoop.startIndex + 1}. ${recommendedLoop.startNote}`;

    document.getElementById(
        "loop-end-note"
    ).textContent =
        `${recommendedLoop.endIndex + 1}. ${recommendedLoop.endNote}`;

    document.getElementById(
        "loop-speed"
    ).textContent =
        recommendedLoop.speed;

    document.getElementById(
        "loop-issue"
    ).textContent =
        recommendedLoop.issue;

    const badge =
        document.getElementById(
            "practice-loop-badge"
        );

    const message =
        document.getElementById(
            "practice-loop-message"
        );

    if (
        recommendedLoop.severity <
        10
    ) {
        badge.textContent =
            "Polish section";

        message.textContent =
            `The performance is already strong, so this is a short section to polish: notes ${recommendedLoop.startIndex + 1}–${recommendedLoop.endIndex + 1}.`;

    } else {

        badge.textContent =
            "Weakest section";

        message.textContent =
            `I recommend looping notes ${recommendedLoop.startIndex + 1}–${recommendedLoop.endIndex + 1}. The main issue in this section is ${recommendedLoop.issue.toLowerCase()}, so start at ${recommendedLoop.speed} speed.`;
    }
}


function practiseRecommendedLoop() {

    if (
        !recommendedLoop ||
        !loadedMusicXMLText
    ) {
        return;
    }

    const startNote =
        loadedPhrase[
            recommendedLoop.startIndex
        ];

    const endNote =
        loadedPhrase[
            recommendedLoop.endIndex
        ];

    if (!startNote || !endNote) {
        return;
    }

    localStorage.setItem(
        "ymtPracticeMusicXML",
        loadedMusicXMLText
    );

    localStorage.setItem(
        "ymtPracticeMusicXMLName",
        loadedMusicXMLName
    );

    localStorage.setItem(
        "ymtPracticeInstrument",
        "alto-sax"
    );

    const speedMap = {
        "50%": "0.5",
        "75%": "0.75",
        "100%": "1"
    };

    const params =
        new URLSearchParams({
            practiceFromScorecard: "1",
            loopStartBeat:
                String(
                    startNote.startBeats
                ),
            loopEndBeat:
                String(
                    endNote.startBeats +
                    endNote.durationBeats
                ),
            speed:
                speedMap[
                    recommendedLoop.speed
                ] || "0.75"
        });

    window.location.href =
        `/?${params.toString()}`;
}


function clearLoopHighlight() {

    document
        .querySelectorAll(
            "#results-body tr"
        )
        .forEach(row =>
            row.classList.remove(
                "practice-loop-row"
            )
        );
}


function applyRecommendedLoop() {

    clearLoopHighlight();

    if (!recommendedLoop) {
        return;
    }

    highlightRecommendedLoopOnTimeline();

    const rows =
        Array.from(
            document.querySelectorAll(
                "#results-body tr"
            )
        );

    for (
        let index =
            recommendedLoop.startIndex;
        index <=
            recommendedLoop.endIndex;
        index++
    ) {

        rows[
            index
        ]?.classList.add(
            "practice-loop-row"
        );
    }

    document.getElementById(
        "practice-loop-message"
    ).textContent =
        `Practice loop selected: notes ${recommendedLoop.startIndex + 1}–${recommendedLoop.endIndex + 1} at ${recommendedLoop.speed}. In the main tutorial, this will become the same loop region used by the drag-to-loop player.`;
}


function renderResults(
    results
) {

    currentResults =
        results;

    const summary =
        calculateSummary(
            results
        );

    [
        [
            "note-score",
            summary.noteAccuracy
        ],
        [
            "tuning-score",
            summary.tuning
        ],
        [
            "timing-score",
            summary.timing
        ],
        [
            "duration-score",
            summary.duration
        ]
    ].forEach(
        ([id, value]) => {

            const element =
                document.getElementById(
                    id
                );

            element.textContent =
                `${value}%`;

            element.className =
                `summary-value ${scoreClass(
                    value
                )}`;
        }
    );

    const overall =
        document.getElementById(
            "overall-score"
        );

    overall.textContent =
        `${summary.overall}%`;

    overall.className =
        `overall-score ${scoreClass(
            summary.overall
        )}`;

    document.getElementById(
        "overall-copy"
    ).textContent =
        summary.overall >= 90
            ? "Excellent control across this tutorial."
            : summary.overall >= 75
                ? "A strong attempt with a few areas to tighten."
                : summary.overall >= 60
                    ? "Some solid foundations, with clear areas to practise."
                    : "Useful attempt — the analysis below shows where to focus.";

    const wrong =
        results.filter(
            result =>
                !result.correct
        );

    const weak =
        results.filter(
            result =>
                weaknessFor(
                    result
                ) !==
                "Good"
        );

    const meanTiming =
        results.reduce(
            (
                sum,
                result
            ) =>
                sum +
                result.timingError,
            0
        ) /
        results.length;

    const meanDuration =
        results.reduce(
            (
                sum,
                result
            ) =>
                sum +
                (
                    (
                        result.heldDuration -
                        result.expected.duration
                    ) /
                    result.expected.duration
                ),
            0
        ) /
        results.length;

    let coaching =
        `<strong>${
            summary.overall >= 75
                ? "Good progress."
                : "You're getting there."
        }</strong> ` +
        `You scored ${summary.noteAccuracy}% for note accuracy, ` +
        `${summary.tuning}% for tuning, ${summary.timing}% for timing ` +
        `and ${summary.duration}% for note length. `;

    if (wrong.length) {
        coaching +=
            `Wrong notes were detected at positions ${wrong.map(
                result =>
                    result.index + 1
            ).join(", ")}. `;
    }

    if (meanTiming > 0.08) {
        coaching +=
            "You tend to enter notes late. ";
    } else if (meanTiming < -0.08) {
        coaching +=
            "You tend to enter notes early. ";
    }

    if (meanDuration < -0.08) {
        coaching +=
            "You tend to release notes too early. ";
    } else if (meanDuration > 0.08) {
        coaching +=
            "You tend to hold notes too long. ";
    }

    if (weak.length) {
        coaching +=
            `A good practice loop would focus on note positions ${weak.map(
                result =>
                    result.index + 1
            ).join(", ")}.`;
    }

    document.getElementById(
        "coaching"
    ).innerHTML =
        coaching;

    updatePracticeLoopRecommendation(
        results
    );

    const body =
        document.getElementById(
            "results-body"
        );

    body.innerHTML = "";

    results.forEach(
        result => {

            const row =
                document.createElement(
                    "tr"
                );

            const tuning =
                result.correct
                    ? `${
                        result.cents >= 0
                            ? "+"
                            : ""
                    }${result.cents.toFixed(
                        1
                    )}c (${result.tuningScore}%)`
                    : "—";

            const holdDifference =
                result.heldDuration -
                result.expected.duration;

            row.innerHTML = `
                <td>${result.index + 1}</td>

                <td>
                    <span class="note-pill">
                        ${result.expected.pitch}
                    </span>
                </td>

                <td>
                    <span class="note-pill">
                        ${result.detectedNote}
                    </span>
                </td>

                <td class="${
                    result.correct
                        ? "good"
                        : "bad"
                }">
                    ${
                        result.correct
                            ? "✓ Correct"
                            : "✗ Wrong"
                    }
                </td>

                <td>${tuning}</td>

                <td>
                    ${
                        result.timingError >= 0
                            ? "+"
                            : ""
                    }${result.timingError.toFixed(
                        2
                    )}s
                    (${result.timing.score}%)
                    <br>
                    <small>
                        ${result.timing.label}
                    </small>
                </td>

                <td>
                    ${result.heldDuration.toFixed(
                        2
                    )}s / ${result.expected.duration.toFixed(
                        2
                    )}s
                    (${result.duration.score}%)
                    <br>
                    <small>
                        ${
                            holdDifference >= 0
                                ? "+"
                                : ""
                        }${holdDifference.toFixed(
                            2
                        )}s · ${result.duration.label}
                    </small>
                </td>

                <td class="${
                    weaknessFor(
                        result
                    ) ===
                    "Good"
                        ? "good"
                        : "warn"
                }">
                    ${weaknessFor(
                        result
                    )}
                </td>
            `;

            body.appendChild(
                row
            );
        }
    );

    document.getElementById(
        "summary"
    ).style.display =
        "block";
}


document.addEventListener(
    "DOMContentLoaded",
    () => {

        document.getElementById(
            "load-file"
        ).addEventListener(
            "click",
            loadChosenFile
        );

        document.getElementById(
            "analyse-performance"
        ).addEventListener(
            "click",
            analysePerformance
        );

        document.getElementById(
            "expand-before"
        )?.addEventListener(
            "click",
            () =>
                expandActiveLoop(
                    1,
                    0
                )
        );

        document.getElementById(
            "expand-after"
        )?.addEventListener(
            "click",
            () =>
                expandActiveLoop(
                    0,
                    1
                )
        );

        document.getElementById(
            "expand-both"
        )?.addEventListener(
            "click",
            () =>
                expandActiveLoop(
                    1,
                    1
                )
        );

        restoreCoachingFromTutorial();


        document.getElementById(
            "apply-loop"
        ).addEventListener(
            "click",
            applyRecommendedLoop
        );

        document.getElementById(
            "clear-loop"
        ).addEventListener(
            "click",
            clearLoopHighlight
        );

        document.getElementById(
            "undo-loop"
        )?.addEventListener(
            "click",
            undoLoopChange
        );

        updateUndoButton();

        document.getElementById(
            "practise-loop"
        ).addEventListener(
            "click",
            practiseRecommendedLoop
        );

        const practiceTimeline =
            document.getElementById(
                "practice-timeline-viewport"
            );

        practiceTimeline.addEventListener(
            "pointerdown",
            beginPracticeTimelineDrag
        );

        practiceTimeline.addEventListener(
            "pointermove",
            movePracticeTimelineDrag
        );

        practiceTimeline.addEventListener(
            "pointerup",
            endPracticeTimelineDrag
        );

        practiceTimeline.addEventListener(
            "pointercancel",
            endPracticeTimelineDrag
        );
    }
);
