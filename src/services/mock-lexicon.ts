import type { Accent, PhraseExplanation, SentenceExplanation } from '@/types';

/**
 * Hand-written demo data.
 *
 * This is what makes the extension testable before a backend exists. Entries
 * here are real lexicography, written by hand — the generic fallback in
 * mock-ai.ts is clearly labelled as placeholder so demo mode never passes
 * invented definitions off as knowledge.
 */

export interface MockWordEntry {
  word: string;
  ipa: Record<Accent, string>;
  phonetic: string;
  partOfSpeech: string;
  /** What it means in most contexts — the plain-English gloss. */
  simpleMeaning: string;
  /** Contextual reading, written to fit the demo sentences below. */
  contextualMeaning: string;
  beginnerMeaning: string;
  authorIntent: string;
  tone: string;
  register: string;
  synonyms: string[];
  naturalAlternative: string;
  example: string;
}

export const MOCK_WORDS: Record<string, MockWordEntry> = {
  ostensibly: {
    word: 'ostensibly',
    ipa: { american: '/ɑːˈstɛnsəbli/', british: '/ɒˈstɛnsɪbli/' },
    phonetic: 'os-TEN-suh-blee',
    partOfSpeech: 'adverb',
    simpleMeaning: 'Apparently, but perhaps not actually.',
    contextualMeaning:
      'Something appears to be true or is presented as the reason, although it may not actually be the real one.',
    beginnerMeaning: 'It looks true, but maybe it is not really true.',
    authorIntent:
      'The wording suggests the writer doubts that the stated reason is the real reason, without saying so outright.',
    tone: 'Formal, somewhat skeptical',
    register: 'Academic / journalistic',
    synonyms: ['apparently', 'seemingly', 'supposedly', 'on the face of it'],
    naturalAlternative: 'apparently',
    example: 'The project was ostensibly created to reduce costs.',
  },
  pragmatic: {
    word: 'pragmatic',
    ipa: { american: '/præɡˈmætɪk/', british: '/præɡˈmatɪk/' },
    phonetic: 'prag-MAT-ik',
    partOfSpeech: 'adjective',
    simpleMeaning: 'Practical: focused on what works rather than on theory or ideals.',
    contextualMeaning:
      'Dealing with things in a sensible, practical way rather than following strict ideas or principles.',
    beginnerMeaning: 'Practical. It deals with real problems instead of big ideas.',
    authorIntent:
      'Calling an approach pragmatic usually signals approval of its realism — which is why pairing it with doubt is pointed.',
    tone: 'Neutral, mildly approving',
    register: 'Business / academic',
    synonyms: ['practical', 'realistic', 'down-to-earth', 'sensible'],
    naturalAlternative: 'practical',
    example: 'She took a pragmatic view and fixed the cheapest problem first.',
  },
  belies: {
    word: 'belies',
    ipa: { american: '/bɪˈlaɪz/', british: '/bɪˈlaɪz/' },
    phonetic: 'buh-LYZE',
    partOfSpeech: 'verb (third person singular of "belie")',
    simpleMeaning: 'Hides the truth about something, or shows it to be false.',
    contextualMeaning:
      'Gives a misleading impression of what is really happening — the surface appearance contradicts the reality.',
    beginnerMeaning: 'It hides what is really true.',
    authorIntent:
      'The verb tells you a contrast is coming: whatever follows is the reality that the appearance was covering.',
    tone: 'Formal, analytical',
    register: 'Literary / academic',
    synonyms: ['contradicts', 'conceals', 'disguises', 'misrepresents'],
    naturalAlternative: 'hides',
    example: 'His calm voice belies how nervous he actually is.',
  },
  ideological: {
    word: 'ideological',
    ipa: { american: '/ˌaɪdiəˈlɑːdʒɪkəl/', british: '/ˌʌɪdɪəˈlɒdʒɪkl/' },
    phonetic: 'eye-dee-uh-LOJ-i-kul',
    partOfSpeech: 'adjective',
    simpleMeaning: 'Relating to a system of beliefs, especially political ones.',
    contextualMeaning:
      'Concerning underlying beliefs and principles rather than practical details.',
    beginnerMeaning: 'About beliefs — especially political beliefs.',
    authorIntent:
      'Framing a change as ideological rather than practical implies it is driven by values, not by evidence.',
    tone: 'Analytical',
    register: 'Political / academic',
    synonyms: ['doctrinal', 'philosophical', 'political'],
    naturalAlternative: 'belief-driven',
    example: 'The two parties differ on ideological grounds, not just on tactics.',
  },
  ambiguous: {
    word: 'ambiguous',
    ipa: { american: '/æmˈbɪɡjuəs/', british: '/amˈbɪɡjʊəs/' },
    phonetic: 'am-BIG-yoo-us',
    partOfSpeech: 'adjective',
    simpleMeaning: 'Open to more than one interpretation; unclear.',
    contextualMeaning: 'Able to be understood in more than one way, so the intended meaning is not certain.',
    beginnerMeaning: 'It can mean more than one thing, so it is not clear.',
    authorIntent: 'Describing something as ambiguous often hints that the vagueness may be deliberate.',
    tone: 'Neutral, cautious',
    register: 'General / academic',
    synonyms: ['unclear', 'vague', 'equivocal', 'open to interpretation'],
    naturalAlternative: 'unclear',
    example: 'The contract was deliberately ambiguous about who pays for repairs.',
  },
  meticulous: {
    word: 'meticulous',
    ipa: { american: '/məˈtɪkjələs/', british: '/mɪˈtɪkjʊləs/' },
    phonetic: 'muh-TIK-yuh-lus',
    partOfSpeech: 'adjective',
    simpleMeaning: 'Extremely careful about small details.',
    contextualMeaning: 'Showing great attention to detail, to the point of being exacting.',
    beginnerMeaning: 'Very careful about small details.',
    authorIntent: 'It is almost always praise, though it can suggest slowness.',
    tone: 'Positive, admiring',
    register: 'General / professional',
    synonyms: ['thorough', 'painstaking', 'scrupulous', 'exacting'],
    naturalAlternative: 'very careful',
    example: 'Her meticulous notes made the experiment easy to repeat.',
  },
  ubiquitous: {
    word: 'ubiquitous',
    ipa: { american: '/juːˈbɪkwətəs/', british: '/juːˈbɪkwɪtəs/' },
    phonetic: 'yoo-BIK-wuh-tus',
    partOfSpeech: 'adjective',
    simpleMeaning: 'Found everywhere; extremely common.',
    contextualMeaning: 'Present or seen everywhere at once, to the point of being unremarkable.',
    beginnerMeaning: 'It is everywhere.',
    authorIntent: 'Often used to make a point about how normal something has become.',
    tone: 'Neutral, faintly wry',
    register: 'Academic / journalistic',
    synonyms: ['omnipresent', 'everywhere', 'pervasive', 'universal'],
    naturalAlternative: 'everywhere',
    example: 'Smartphones are now ubiquitous in classrooms.',
  },
  counterintuitive: {
    word: 'counterintuitive',
    ipa: { american: '/ˌkaʊntərɪnˈtuːɪtɪv/', british: '/ˌkaʊntərɪnˈtjuːɪtɪv/' },
    phonetic: 'kown-ter-in-TOO-i-tiv',
    partOfSpeech: 'adjective',
    simpleMeaning: 'True even though it feels like it should not be.',
    contextualMeaning: 'Going against what you would naturally expect, even though it is correct.',
    beginnerMeaning: 'It is true, but it feels wrong at first.',
    authorIntent: 'Signals that the writer is about to overturn an assumption the reader probably holds.',
    tone: 'Neutral, explanatory',
    register: 'Academic / popular science',
    synonyms: ['surprising', 'unexpected', 'paradoxical'],
    naturalAlternative: 'surprising',
    example: 'It sounds counterintuitive, but adding lanes can make traffic worse.',
  },
  nuance: {
    word: 'nuance',
    ipa: { american: '/ˈnuːɑːns/', british: '/ˈnjuːɑːns/' },
    phonetic: 'NOO-ahns',
    partOfSpeech: 'noun',
    simpleMeaning: 'A small difference in meaning, feeling or tone.',
    contextualMeaning: 'A subtle shade of meaning that changes how something should be understood.',
    beginnerMeaning: 'A small difference in meaning.',
    authorIntent: 'Asking for nuance usually implies the other side is over-simplifying.',
    tone: 'Neutral',
    register: 'General / academic',
    synonyms: ['subtlety', 'shade', 'distinction', 'fine point'],
    naturalAlternative: 'subtle difference',
    example: 'Translation often loses the nuance of the original.',
  },
  salient: {
    word: 'salient',
    ipa: { american: '/ˈseɪliənt/', british: '/ˈseɪlɪənt/' },
    phonetic: 'SAY-lee-unt',
    partOfSpeech: 'adjective',
    simpleMeaning: 'Most noticeable or most important.',
    contextualMeaning: 'Standing out as the point that matters most among several.',
    beginnerMeaning: 'The most important part.',
    authorIntent: 'Used to steer the reader towards the detail the writer thinks is decisive.',
    tone: 'Neutral, formal',
    register: 'Academic',
    synonyms: ['key', 'prominent', 'notable', 'central'],
    naturalAlternative: 'most important',
    example: 'The salient point is that nobody read the contract.',
  },
  ephemeral: {
    word: 'ephemeral',
    ipa: { american: '/ɪˈfɛmərəl/', british: '/ɪˈfɛm(ə)rəl/' },
    phonetic: 'ih-FEM-er-ul',
    partOfSpeech: 'adjective',
    simpleMeaning: 'Lasting only a very short time.',
    contextualMeaning: 'Short-lived, and usually valued or regretted because of it.',
    beginnerMeaning: 'It does not last long.',
    authorIntent: 'Carries a slightly wistful feeling that "temporary" does not.',
    tone: 'Literary, wistful',
    register: 'Literary',
    synonyms: ['fleeting', 'transient', 'short-lived', 'momentary'],
    naturalAlternative: 'short-lived',
    example: 'Social media fame is famously ephemeral.',
  },
  scrutiny: {
    word: 'scrutiny',
    ipa: { american: '/ˈskruːtəni/', british: '/ˈskruːtɪni/' },
    phonetic: 'SKROO-tuh-nee',
    partOfSpeech: 'noun',
    simpleMeaning: 'Close, critical examination.',
    contextualMeaning: 'Careful inspection, usually by people looking for problems.',
    beginnerMeaning: 'Looking at something very carefully to find problems.',
    authorIntent: 'Implies the thing being examined may not survive the examination.',
    tone: 'Neutral, slightly adversarial',
    register: 'Journalistic / legal',
    synonyms: ['examination', 'inspection', 'review', 'oversight'],
    naturalAlternative: 'close examination',
    example: 'The proposal collapsed under scrutiny.',
  },
  mitigate: {
    word: 'mitigate',
    ipa: { american: '/ˈmɪtɪɡeɪt/', british: '/ˈmɪtɪɡeɪt/' },
    phonetic: 'MIT-i-gate',
    partOfSpeech: 'verb',
    simpleMeaning: 'To make something bad less severe.',
    contextualMeaning: 'To reduce the harm or seriousness of something rather than prevent it entirely.',
    beginnerMeaning: 'To make something bad less bad.',
    authorIntent: 'Quietly concedes that the problem will not go away — only shrink.',
    tone: 'Neutral, formal',
    register: 'Policy / business',
    synonyms: ['reduce', 'lessen', 'ease', 'alleviate'],
    naturalAlternative: 'reduce',
    example: 'Planting trees can mitigate some of the flooding risk.',
  },
  arbitrary: {
    word: 'arbitrary',
    ipa: { american: '/ˈɑːrbɪtrɛri/', british: '/ˈɑːbɪt(rə)ri/' },
    phonetic: 'AR-bi-trair-ee',
    partOfSpeech: 'adjective',
    simpleMeaning: 'Chosen without a clear reason or system.',
    contextualMeaning: 'Decided by personal choice rather than by rule or evidence — often unfairly.',
    beginnerMeaning: 'Chosen for no good reason.',
    authorIntent: 'Almost always a criticism: it says a decision cannot be justified.',
    tone: 'Critical',
    register: 'General / legal',
    synonyms: ['random', 'capricious', 'unjustified', 'unprincipled'],
    naturalAlternative: 'random',
    example: 'The cut-off date felt completely arbitrary.',
  },
};

export interface MockPhraseEntry extends Omit<PhraseExplanation, 'type' | 'contextualMeaning'> {
  contextualMeaning: string;
}

export const MOCK_PHRASES: Record<string, MockPhraseEntry> = {
  'move the goalposts': {
    phrase: 'move the goalposts',
    meaning: 'To unfairly change the rules or expectations after something has already started.',
    contextualMeaning:
      'Here it accuses someone of changing what counts as success once the other side had already met the original standard.',
    literalMeaning: 'In football, physically shifting the goal so the ball can no longer go in.',
    figurative: true,
    register: 'Informal / idiomatic — common in business and politics',
    tone: 'Critical, frustrated',
    example: 'Every time we hit the target, they move the goalposts.',
    alternatives: ['change the rules midway', 'shift the criteria', 'raise the bar after the fact'],
    keyVocabulary: [
      { word: 'goalpost', gloss: 'One of the two posts marking a goal in football.' },
    ],
    confidence: 'high',
  },
  'the elephant in the room': {
    phrase: 'the elephant in the room',
    meaning: 'An obvious problem that everyone is deliberately not talking about.',
    contextualMeaning: 'It points at the issue the surrounding discussion has been carefully avoiding.',
    literalMeaning: 'An animal far too large to overlook, standing in an ordinary room.',
    figurative: true,
    register: 'Informal / idiomatic',
    tone: 'Pointed, slightly impatient',
    example: 'Nobody mentioned the budget — the elephant in the room.',
    alternatives: ['the obvious unspoken problem', 'what nobody wants to say'],
    keyVocabulary: [],
    confidence: 'high',
  },
  'double-edged sword': {
    phrase: 'double-edged sword',
    meaning: 'Something with both a clear benefit and a real drawback.',
    contextualMeaning: 'It flags that the advantage being described carries a matching cost.',
    literalMeaning: 'A blade sharpened on both sides, which can cut the person wielding it.',
    figurative: true,
    register: 'Neutral / idiomatic',
    tone: 'Balanced, cautionary',
    example: 'Remote work is a double-edged sword: more freedom, less connection.',
    alternatives: ['a mixed blessing', 'a trade-off'],
    keyVocabulary: [],
    confidence: 'high',
  },
};

/** Curated sentence explanations, keyed by a normalised form of the sentence. */
export const MOCK_SENTENCES: Record<string, Omit<SentenceExplanation, 'type'>> = {
  "the policy's ostensibly pragmatic approach belies a deeper ideological shift": {
    simpleMeaning:
      'The policy appears practical, but it may actually represent a much bigger change in beliefs or political thinking.',
    authorMeaning:
      'Although the policy looks practical, the writer believes something more significant is happening underneath.',
    tone: 'Analytical and somewhat skeptical',
    register: 'Journalistic / academic',
    simplifiedRewrite:
      'The policy looks practical, but it may actually reflect a deeper change in beliefs.',
    segments: [
      {
        text: "The policy's ostensibly pragmatic approach",
        meaning: 'The policy looks practical on the surface.',
      },
      { text: 'belies', meaning: 'hides or contradicts what is actually true.' },
      {
        text: 'a deeper ideological shift',
        meaning: 'a more significant change in underlying beliefs or principles.',
      },
    ],
    keyVocabulary: [
      { word: 'ostensibly', gloss: 'apparently, but perhaps not actually', ipa: '/ɑːˈstɛnsəbli/' },
      { word: 'pragmatic', gloss: 'practical rather than idealistic', ipa: '/præɡˈmætɪk/' },
      { word: 'belies', gloss: 'hides or contradicts the truth', ipa: '/bɪˈlaɪz/' },
      { word: 'ideological', gloss: 'relating to a system of beliefs', ipa: '/ˌaɪdiəˈlɑːdʒɪkəl/' },
    ],
    grammarNote:
      'The subject is the long noun phrase “The policy\'s ostensibly pragmatic approach”; “belies” is its verb, and “a deeper ideological shift” is the object. The adverb “ostensibly” modifies the adjective “pragmatic”, not the verb.',
    confidence: 'high',
  },
};
