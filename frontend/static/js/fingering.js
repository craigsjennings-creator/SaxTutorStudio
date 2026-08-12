/*
 * YourMusicTutorial - Saxophone Fingering Map
 *
 * Key IDs are intentionally physical and reusable by:
 *   1) the scrolling tutorial timeline
 *   2) the future interactive sax SVG
 *
 * Default fingerings cover the common written saxophone range
 * from low Bb (Bb3) through high F# (F#6).
 *
 * Alternate fingerings can be added later without changing
 * the timeline engine.
 */

const SAX_FINGERINGS = {

    /* =====================================================
       LOW REGISTER
       ===================================================== */

    "A#3": {
        name: "Bb3",
        keys: [
            "left_1", "left_2", "left_3",
            "right_1", "right_2", "right_3",
            "low_c", "low_bb"
        ]
    },

    "B3": {
        keys: [
            "left_1", "left_2", "left_3",
            "right_1", "right_2", "right_3",
            "low_c", "low_b"
        ]
    },

    "C4": {
        keys: [
            "left_1", "left_2", "left_3",
            "right_1", "right_2", "right_3",
            "low_c"
        ]
    },

    "C#4": {
        keys: [
            "left_1", "left_2", "left_3",
            "right_1", "right_2", "right_3",
            "low_c", "low_c_sharp"
        ]
    },

    "D4": {
        keys: [
            "left_1", "left_2", "left_3",
            "right_1", "right_2", "right_3"
        ]
    },

    "D#4": {
        name: "Eb4",
        keys: [
            "left_1", "left_2", "left_3",
            "right_1", "right_2", "right_3",
            "eb_key"
        ]
    },

    "E4": {
        keys: [
            "left_1", "left_2", "left_3",
            "right_1", "right_2"
        ]
    },

    "F4": {
        keys: [
            "left_1", "left_2", "left_3",
            "right_1"
        ]
    },

    "F#4": {
        keys: [
            "left_1", "left_2", "left_3",
            "right_2"
        ]
    },

    "G4": {
        keys: [
            "left_1", "left_2", "left_3"
        ]
    },

    "G#4": {
        name: "Ab4",
        keys: [
            "left_1", "left_2", "left_3",
            "g_sharp"
        ]
    },

    "A4": {
        keys: [
            "left_1", "left_2"
        ]
    },

    /*
     * Default Bb uses the bis Bb key.
     * Side Bb can be added later as an alternate fingering.
     */
    "A#4": {
        name: "Bb4",
        keys: [
            "left_1",
            "bis_bb"
        ]
    },

    "B4": {
        keys: [
            "left_1"
        ]
    },

    "C5": {
        keys: [
            "left_2"
        ]
    },

    "C#5": {
        keys: []
    },


    /* =====================================================
       OCTAVE REGISTER
       ===================================================== */

    "D5": {
        keys: [
            "octave",
            "left_1", "left_2", "left_3",
            "right_1", "right_2", "right_3"
        ]
    },

    "D#5": {
        name: "Eb5",
        keys: [
            "octave",
            "left_1", "left_2", "left_3",
            "right_1", "right_2", "right_3",
            "eb_key"
        ]
    },

    "E5": {
        keys: [
            "octave",
            "left_1", "left_2", "left_3",
            "right_1", "right_2"
        ]
    },

    "F5": {
        keys: [
            "octave",
            "left_1", "left_2", "left_3",
            "right_1"
        ]
    },

    "F#5": {
        keys: [
            "octave",
            "left_1", "left_2", "left_3",
            "right_2"
        ]
    },

    "G5": {
        keys: [
            "octave",
            "left_1", "left_2", "left_3"
        ]
    },

    "G#5": {
        name: "Ab5",
        keys: [
            "octave",
            "left_1", "left_2", "left_3",
            "g_sharp"
        ]
    },

    "A5": {
        keys: [
            "octave",
            "left_1", "left_2"
        ]
    },

    "A#5": {
        name: "Bb5",
        keys: [
            "octave",
            "left_1",
            "bis_bb"
        ]
    },

    "B5": {
        keys: [
            "octave",
            "left_1"
        ]
    },

    "C6": {
        keys: [
            "octave",
            "left_2"
        ]
    },

    "C#6": {
        keys: [
            "octave"
        ]
    },


    /* =====================================================
       PALM / HIGH REGISTER
       ===================================================== */

    "D6": {
        keys: [
            "octave",
            "palm_d"
        ]
    },

    "D#6": {
        name: "Eb6",
        keys: [
            "octave",
            "palm_d",
            "palm_eb"
        ]
    },

    "E6": {
        keys: [
            "octave",
            "palm_d",
            "palm_eb",
            "palm_f"
        ]
    },

    "F6": {
        keys: [
            "octave",
            "palm_d",
            "palm_eb",
            "palm_f"
        ]
    },

    /*
     * High F# assumes a saxophone fitted with a high-F# key.
     * We can add a front-F based alternate later.
     */
    "F#6": {
        keys: [
            "octave",
            "palm_d",
            "palm_eb",
            "palm_f",
            "high_f_sharp"
        ]
    }
};


/*
 * music21 commonly represents flats with a hyphen:
 *     Bb4 -> B-4
 *
 * Add enharmonic aliases so the timeline works regardless
 * of whether the MusicXML/music21 result is sharp or flat.
 */
const SAX_ENHARMONIC_ALIASES = {
    "B-3": "A#3",
    "Bb3": "A#3",

    "D-4": "C#4",
    "Db4": "C#4",
    "E-4": "D#4",
    "Eb4": "D#4",
    "G-4": "F#4",
    "Gb4": "F#4",
    "A-4": "G#4",
    "Ab4": "G#4",
    "B-4": "A#4",
    "Bb4": "A#4",

    "D-5": "C#5",
    "Db5": "C#5",
    "E-5": "D#5",
    "Eb5": "D#5",
    "G-5": "F#5",
    "Gb5": "F#5",
    "A-5": "G#5",
    "Ab5": "G#5",
    "B-5": "A#5",
    "Bb5": "A#5",

    "D-6": "C#6",
    "Db6": "C#6",
    "E-6": "D#6",
    "Eb6": "D#6",
    "G-6": "F#6",
    "Gb6": "F#6"
};


Object.entries(SAX_ENHARMONIC_ALIASES)
    .forEach(([alias, canonical]) => {

        if (SAX_FINGERINGS[canonical]) {
            SAX_FINGERINGS[alias] =
                SAX_FINGERINGS[canonical];
        }

    });


function getSaxFingering(noteName) {

    return SAX_FINGERINGS[noteName] || null;

}


window.SAX_FINGERINGS = SAX_FINGERINGS;
window.getSaxFingering = getSaxFingering;
