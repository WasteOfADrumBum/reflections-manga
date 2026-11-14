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
    note: "The first ten pages are up as an early look. More pages land here as they are finished.",
    cast: ["ethan-walker", "morgan-hayes", "ruby-bennett-walker", "rowan-hayes-walker", "riley-hayes-walker", "avery-bennett-walker"],
    pages: [
      { src: "/pages/chapter-001/001.webp", alt: "Morning in the kitchen. Morgan, stirring a bowl, says: \"Ethan. Shoes. Rowan's looking for his again.\" Ethan answers: \"Got it, Hun.\" Rowan sits on the entry bench wearing one shoe. Ethan crouches and holds out the missing sneaker. Rowan: \"It wasn't there before.\" Ethan: \"Very sneaky shoe.\" Morgan straightens Ethan's shirt and says: \"What would I do without you?\" In the last panel Ethan turns, smiling, as a voice from off-panel calls: \"Ethan?\"", width: 1024, height: 1536 },
      { src: "/pages/chapter-001/002.webp", alt: "By the coat hooks, Riley works at her purple hoodie's zipper and says: \"I can do it myself.\" Ruby, sitting on a stool, replies: \"Okay. I'm here if you need me.\" Ethan watches from the kitchen. The zipper goes up with a \"zzip\" and Riley grins: \"See?\" As Riley walks off to join Rowan, Ruby asks Ethan: \"Do you think I handled that right? I nearly took over.\" Ethan, crouched beside her: \"You did fine. She needed you to listen. You listened.\" Ruby smiles: \"Thanks.\" Morgan appears in the doorway behind them.", width: 1024, height: 1536 },
      { src: "/pages/chapter-001/003.webp", alt: "Morgan leans in the doorway: \"Ruby. You two planning on staying in here all morning?\" Ruby, with Rowan and Riley beside her: \"He's giving me a pep talk.\" Morgan: \"Of course he is.\" Morgan kisses Ethan on the cheek while Ruby smiles. A close-up shows Ruby's hand, wearing her ring, resting on Ethan's as she says: \"Your shirt's crooked again.\" Morgan: \"I just fixed that.\" Ethan laughs: \"Thanks anyway, Morgan.\" The whole family is gathered, with Avery at the table holding a spoon and laughing.", width: 1024, height: 1536 },
      { src: "/pages/chapter-001/004.webp", alt: "Ethan stands alone at the bathroom sink, facing the mirror. Narration: \"Morgan trusts me to follow her.\" Closer on his reflection: \"Ruby trusts me to lead her.\" Closer still, his expression uncertain: \"Sometimes I wonder which one of them actually knows me.\" The final panel pulls back to show him leaning on the sink: \"Sometimes I wonder if I do.\" Title: Three Hearts, Different Needs.", width: 1024, height: 1536 },
      { src: "/pages/chapter-001/005.webp", alt: "Morgan packs a big olive canvas bag at the kitchen table. Ruby asks: \"You taking the big bag?\" Morgan: \"I'm trying to travel light.\" Ruby laughs: \"Ambitious.\" Ethan walks in as Ruby heads out and says: \"This looks optimistic.\" Morgan, pushing a blanket into the bag: \"We're doing it this way.\" Ethan: \"All that in one bag?\" Morgan lifts it by the straps: \"One bag. Two free hands.\"", width: 1024, height: 1536 },
      { src: "/pages/chapter-001/006.webp", alt: "Ethan leans on the table beside the packed bag and a blue water bottle: \"You know I can still tell you when that's a terrible idea.\" Morgan smirks: \"You usually do.\" A close-up shows Ethan trying to fit the bottle in on top of the blanket. Ethan: \"This is one of those times.\" Morgan holds out her hand: \"All right. Show me.\"", width: 1024, height: 1536 },
      { src: "/pages/chapter-001/007.webp", alt: "Ethan slides the water bottle into the bag's outside pocket: \"Outside pocket.\" Morgan: \"That's what it's for.\" Then: \"Fine. You get one point.\" Ethan: \"I'm keeping score now.\" Morgan sets the strap on his shoulder: \"You can carry your victory.\" Ethan: \"Gladly.\" As they head out, Ethan says: \"No promises.\" Morgan, glancing back: \"Try to keep up.\"", width: 1024, height: 1536 },
      { src: "/pages/chapter-001/008.webp", alt: "Ruby sits at the kitchen table with a mug of coffee as Ethan walks over. Ruby: \"Bag sorted?\" Ethan: \"After extensive negotiations.\" She slides a second mug toward him: \"Yours is there.\" Ethan sits: \"Thanks, Babe.\" He looks down at the mug and goes quiet. Ruby, watching him with worried eyes: \"Are you upset with me?\"", width: 1024, height: 1536 },
      { src: "/pages/chapter-001/009.webp", alt: "Ethan, arms folded on the table, answers gently: \"No, Babe.\" Ruby: \"You went quiet.\" Ethan: \"Just thinking.\" Ruby: \"About what?\" Ethan glances toward the packed bag by the bench: \"Whether we forgot anything.\" Ruby taps the list in front of her and smiles: \"We haven't.\" Ethan: \"Good.\"", width: 1024, height: 1536 },
      { src: "/pages/chapter-001/010.webp", alt: "Standing by the table, Ruby gestures to his untouched mug: \"You can have your coffee, you know.\" Ethan: \"In a minute.\" He leans his forehead against hers: \"You all right?\" Ruby, eyes closed, smiling: \"I am.\" Ethan: \"Good.\" Her hand rests on his arm. In the last panel the two walk away together, leaving the full mug on the table.", width: 1024, height: 1536 }
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
