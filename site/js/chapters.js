// Cover artwork is front matter, separate from the numbered story-page files.
// Mark only each arc's first chapter with arc: 1..4 and opensArc: true.
// Chapter IDs are assigned during production, not inferred from story IDs.
window.REFLECTIONS_COVERS = {
  "1": {
    "src": "/images/covers/arc-01-three-become-one.webp",
    "alt": "Reflections, Arc 1: Three Become One. Morgan, Ethan and Ruby sit around a kitchen table with coffee in warm morning light.",
    "width": 1024,
    "height": 1536
  },
  "2": {
    "src": "/images/covers/arc-02-the-invisible-weight.webp",
    "alt": "Reflections, Arc 2: The Invisible Weight. Ethan sits with his hands clasped while Morgan stands by the window and Ruby sits beside a basket of laundry.",
    "width": 1024,
    "height": 1536
  },
  "3": {
    "src": "/images/covers/arc-03-fractured-reflections.webp",
    "alt": "Reflections, Arc 3: Fractured Reflections. A cracked mirror separates the reflections of Morgan, Ethan and Ruby as they look in different directions.",
    "width": 1024,
    "height": 1536
  },
  "4": {
    "src": "/images/covers/arc-04-the-choice.webp",
    "alt": "Reflections, Arc 4: The Choice. Morgan, Ethan and Ruby stand with space between them near their open front door, with daylight entering behind them.",
    "width": 1024,
    "height": 1536
  },
  "series": {
    "src": "/images/covers/reflections-cover.webp",
    "alt": "Reflections manga cover. Morgan, Ethan and Ruby stand together at a window at dusk, their reflections visible behind them.",
    "width": 1024,
    "height": 1536
  }
};

// Arc names, used by the reader when Next or Previous moves into another arc.
window.REFLECTIONS_ARCS = { 1: "Three Become One", 2: "The Invisible Weight", 3: "Fractured Reflections", 4: "The Choice" };

window.REFLECTIONS_CHAPTER_COVERS = {
  "001": {
    "src": "/images/covers/arc-01-chapter-01-three-hearts-different-needs.webp",
    "alt": "Reflections: Three Hearts, Different Needs. Ethan faces his reflection in a mirror while Ruby and Morgan watch from the kitchen.",
    "width": 1024,
    "height": 1536
  },
  "002": {
    "src": "/images/covers/arc-01-chapter-02-different-languages.webp",
    "alt": "Reflections: Different Languages. Morgan holds Ethan's shirt near the collar while Ruby rests her hand on his arm; the three are reflected in the window behind them.",
    "width": 1024,
    "height": 1536
  },
  "003": {
    "src": "/images/covers/arc-01-chapter-03-right-beside-you.webp",
    "alt": "Reflections: Right Beside You. Ethan and Ruby sit near one another on a sofa while Morgan knits in an armchair behind them.",
    "width": 1024,
    "height": 1536
  },
  "004": {
    "src": "/images/covers/arc-01-chapter-04-always-the-one-who-reaches.webp",
    "alt": "Reflections: Always the One Who Reaches. Ethan and Morgan sit on a sofa with their hands close but separate. Ruby stands behind them holding a mug.",
    "width": 1024,
    "height": 1536
  }
};

// End-of-chapter cards: shown as the last image of each chapter, after its story pages.
window.REFLECTIONS_CHAPTER_END_CARDS = {
  "001": {
    "src": "/images/covers/arc-01-chapter-01-end-three-hearts-different-needs.webp",
    "alt": "Ruby and Morgan lean against Ethan on either side as the three sit together at dusk. Text: “I know how to be needed. I’m still learning how to be myself.” End of Chapter 1: Three Hearts, Different Needs. Akira. To be continued.",
    "width": 1024,
    "height": 1536
  },
  "002": {
    "src": "/images/covers/arc-01-chapter-02-end-different-languages.webp",
    "alt": "Ruby and Morgan lean on a table on either side of Ethan, who talks with open hands. Text: “I thought I was showing you love. I didn’t realize you were still waiting to feel it.” End of Chapter 2: Different Languages. Akira. To be continued.",
    "width": 1024,
    "height": 1536
  },
  "003": {
    "src": "/images/covers/arc-01-chapter-03-end-right-beside-you.webp",
    "alt": "Ethan and Ruby sit apart on a sofa, glancing at each other, while Morgan reads in an armchair behind them. Text: “I missed you while you were sitting right beside me.” End of Chapter 3: Right Beside You. Akira. To be continued.",
    "width": 1024,
    "height": 1536
  },
  "004": {
    "src": "/images/covers/arc-01-chapter-04-end-always-the-one-who-reaches.webp",
    "alt": "Ethan and Morgan stand facing each other as their hands reach and almost touch, while Ruby sits on the sofa behind them holding a mug. Text: “I wanted you to reach for me. I didn’t know how to ask.” End of Chapter 4: Always the One Who Reaches. Akira. End of Arc 1.",
    "width": 1024,
    "height": 1536
  }
};

// Chapters available in the reader, including clearly marked cover previews.
// To publish pages: add page images under site/pages/chapter-001/ and list them here,
// each with descriptive alt text (what happens on the page, including dialogue).
//
// Example page entry:
//   { src: "pages/chapter-001/001.webp", alt: "Ethan stands alone in the kitchen at night...", width: 1200, height: 1700 }
//
// cast: character ids (as used on characters.html) who appear in the chapter.
// Each listed character's bio gets an "Appears in" link to this chapter.
window.REFLECTIONS_CHAPTERS = [
  {
    id: "001",
    arc: 1,
    opensArc: true,
    title: "Three Hearts, Different Needs",
    note: "The first 6 of 30 pages are up as an early look. More pages land here as they are finished.",
    cast: ["ethan-walker", "morgan-hayes", "ruby-bennett-walker", "rowan-hayes-walker", "riley-hayes-walker", "avery-bennett-walker"],
    // Version 2 retelling. Version 1 pages are hidden from the reader and kept in
    // site/pages/chapter-001/version_1/ (see index.json there).
    pages: [
      { src: "/pages/chapter-001/001.webp", alt: "An open photo album shows a wedding portrait in a cream pocket. Narration: \"Morgan, Ruby and Ethan on the day they were married.\" Morgan in a lace gown stands on the left, Ethan in a dark suit and pink tie in the middle, and Ruby in a lace gown and veil on the right. In the kitchen, Ruby opens the album on a low wooden cabinet, the wedding photo beside an empty pocket. Morgan points at the empty pocket: \"Saving this one for something?\" Ruby: \"For us. With the kids this time.\" Ruby looks up at Ethan, who smiles down at her: \"We should get one with all six of us before anybody grows another inch.\" Ethan holds up his phone to take a picture of Morgan and Ruby standing together: \"Okay, squeeze in.\" Ruby, one eyebrow raised: \"That means you too, Ethan.\"", width: 1024, height: 1536 },
      { src: "/pages/chapter-001/002.webp", alt: "Wide view at the low cabinet. The three kids come to see the album. Rowan leans comfortably against Ruby's arm. Riley peers past his elbow. Avery spots a folded section she can reach from the other end. Morgan shifts over to give her room. Stay in the present. From behind the album we see its cloth spine and paper folds. The photographs face the children. Ethan is nearby with his phone, outside the frame. Caption: \"When Rowan and Riley were born, Ethan held Morgan's hand. When Avery was born, Ruby held his.\" Closer on Rowan and Ruby. Rowan draws out one fold and discovers another tucked behind it. He looks up at Ruby, delighted. She bends beside him with her cheek against his hair for a moment. Show both faces and the join in the paper. Rowan: \"Mommy, how long does this thing get?\" Ruby: \"Longer than my sewing table. I had to finish it on the floor.\" Same album, opposite end. Avery has a finger under the last fold, ready to open it. Rowan reaches across to do it for her. Morgan catches his eye and holds up one open hand. Her voice is quiet and matter-of-fact. Show Avery concentrating on the fold, with room to open it herself. Morgan: \"Hang on, Rowan. Let Avery have a turn.\" One continuous wide shot. Avery has opened the fold herself and uncovered the empty pocket. Rowan has drawn his hand back so everyone can see. Riley, the youngest with the chestnut pixie and purple hoodie, leans into Ruby's side and curls her fingers like cat paws. Ruby slips an arm around her and grins...", width: 1024, height: 1536 },
      { src: "/pages/chapter-001/003.webp", alt: "At the back window Morgan points through the window at the line of sunlight just short of the shaded steps. Ethan follows her pointing finger, phone lowered. Morgan: \"Let's use the steps while they're still in the shade.\" Ethan: \"Yes, ma'am.\" Morgan gives him a quick kiss on the mouth. His grin reaches his eyes. Her bare left hand rests on his shoulder. Morgan: \"Oh, now you listen to your wife?\" Ruby collects her mug from the table. Her left wedding band catches against the handle. Her thumb settles against it for a beat. She sees Morgan already working out the angle. Ruby's thought caption: \"Ask for the picture you want. Before it turns into a joke.\" Ruby speaks across Ethan to Morgan, the easy shorthand of best friends. Ethan looks from her to his phone. Ruby: \"Think he'll let us take his picture?\" Morgan: \"I'll get him to the steps. You can talk him into smiling.\"", width: 1024, height: 1536 },
      { src: "/pages/chapter-001/004.webp", alt: "At the open kitchen door Morgan holds a palm level, showing Ethan where the phone could rest on the broad porch rail. No one sets it down yet. Morgan: \"Set the timer. I'll test the spot with you.\" Morgan has taken a cheeky sip while holding Ruby's distinctive rose mug. Draw her lowering it from her mouth as Ruby finishes adjusting her sleeve and reaches to take it back. Ruby: \"That's mine.\" Morgan: \"I know. Yours always tastes better.\" Morgan studies Ethan fiddling with the phone, his back to them. Her grin fades. Morgan's thought caption: \"Turn around, handsome. Just because.\" Ruby catches her looking. They exchange a small crooked smile. Ethan glances back a beat too late. Ruby: \"I saw that.\" Morgan: \"Best friends are supposed to look away.\"", width: 1024, height: 1536 },
      { src: "/pages/chapter-001/005.webp", alt: "Wide view from inside the back door. Morgan leads the three kids onto the shaded porch steps. Ruby puts her mug on the broad windowsill inside before following. Ethan stays at the threshold, phone in hand. Ruby: \"You're coming too, right?\" Ethan: \"I'm right here, Babe.\" Avery taps the step she wants as Riley starts to sit there. Morgan pats the next space along to guide Riley over beside Rowan. Ruby joins the group. Morgan: \"That's Avery's spot. Why don't you scoot this way, Cat?\" View from beside Ethan at the threshold. His shoulder and raised phone frame the left foreground. Beyond him, Ruby and Morgan sit with the three kids on the steps. Ruby looks over the phone at Ethan and pats the open step between her and Morgan. Keep that space plainly visible and point the balloon tail at Ruby's mouth. Ruby: \"There's room right here, Ethan.\" Wide, low shot from behind the porch rail. In the left foreground, Ethan's phone sits horizontally on the broad flat rail, braced against the heavy planter. Its illuminated screen faces the reader and shows a clear, active stopwatch icon over the camera preview. Its rear lens faces the steps. Ethan has just started the countdown and is already jogging from the rail toward the gap beside Ruby on the right. Show him mid-stride, hands empty, with Ruby and the family waiting on the steps. The countdown is still running.", width: 1024, height: 1536 },
      { src: "/pages/chapter-001/006.webp", alt: "Ethan stops short of the gap and glances back at the tilted phone. He returns to the porch rail, taps to cancel the countdown before the shutter fires, and lifts the phone from beside the planter. Ruby comes over from the steps and joins him beside the open door. Both are in shade. Ethan: \"Hang on. I think the phone's crooked.\" Ruby studies him in profile. He blinks slowly. The dark phone screen rests against his thigh. Ruby: \"You doing okay?\" Frame Ethan's face and Ruby's profile. He answers with a practiced little grin. Ruby waits a beat longer than he expects. Give his speech balloon the first reading position, then set his cloud thought lower with its own trail to him. Ethan: \"Yeah. You got me outside. That's usually the hard part.\" Ethan's thought caption: \"I was glad when I stopped the timer.\"", width: 1024, height: 1536 }
    ]
  },
  {
    id: "002",
    arc: 1,
    title: "Different Languages",
    coverOnly: true,
    note: "Chapter cover preview. Story pages are coming soon.",
    cast: [],
    pages: []
  },
  {
    id: "003",
    arc: 1,
    title: "Right Beside You",
    coverOnly: true,
    note: "Chapter cover preview. Story pages are coming soon.",
    cast: [],
    pages: []
  },
  {
    id: "004",
    arc: 1,
    title: "Always the One Who Reaches",
    coverOnly: true,
    note: "Chapter cover preview. Story pages are coming soon.",
    cast: [],
    pages: []
  }
];

// Attach the opening covers before story pages and the end card after them, without renaming pages.
window.REFLECTIONS_CHAPTERS.forEach(function (chapter) {
  var covers = window.REFLECTIONS_COVERS;
  var opening = [];
  if (chapter.opensArc) {
    if (chapter.arc === 1) opening.push(covers.series);
    if (covers[chapter.arc]) opening.push(covers[chapter.arc]);
  }
  var chapterCover = window.REFLECTIONS_CHAPTER_COVERS[chapter.id];
  if (chapterCover) opening.push(chapterCover);
  var endCard = (window.REFLECTIONS_CHAPTER_END_CARDS || {})[chapter.id];
  chapter.pages = opening.concat(chapter.pages || [], endCard ? [endCard] : []);
});
