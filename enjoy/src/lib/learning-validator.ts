import {
  countWords,
  LessonBriefSchema,
  validateLessonDraft,
} from "./learning-schemas";
import {
  CEFR_LEVEL_ORDER,
  getCefrRubric,
  getCuratedTargetLevel,
} from "./cefr-rubrics";
import type {
  ContractValidationIssue,
  Exercise,
  LessonBrief,
  LessonDraft,
  LearningTarget,
} from "../types/learning";

export type LessonValidationMetrics = {
  wordCount: number;
  sentenceCount: number;
  maxSentenceWords: number;
  targetOccurrences: Record<string, number>;
  practiceExposure: Record<string, number>;
};

export type LessonValidationResult = {
  ok: boolean;
  issues: ContractValidationIssue[];
  warnings: ContractValidationIssue[];
  metrics: LessonValidationMetrics;
  data?: LessonDraft;
};

const REQUIRED_EXERCISE_KINDS = ["meaning", "fill", "order", "retell"] as const;
const ENGLISH_FUNCTION_WORDS = new Set([
  "a", "an", "and", "are", "at", "can", "do", "for", "from", "he", "i", "in",
  "is", "it", "my", "of", "on", "she", "that", "the", "their", "they", "this",
  "to", "was", "we", "were", "with", "you",
]);
const VIETNAMESE_FUNCTION_WORDS = new Set([
  "bạn", "cho", "có", "của", "đang", "đến", "đi", "là", "một", "mua", "những",
  "tôi", "trong", "và", "với",
]);
const VIETNAMESE_DIACRITICS = /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/gu;
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
// Keep fill-prefix recognition narrow so grammar checks do not become a generic parser.
const FILL_BLANK_PATTERN = /_{2,}/gu;
const FILL_NOUN_PHRASE_PREFIX_PATTERN = /(?:^|[^\p{L}\p{N}'_])(a|an|the)(?:\s+(large|flexible|small))?\s*$/iu;
const FILL_POSSESSIVE_PREFIX_PATTERN = /(?:^|[^\p{L}\p{N}'_])([A-Z][a-z]{1,31})['’]s\s*$/u;
const FILL_INFINITIVE_PREFIX_PATTERN = /(?:^|[^\p{L}\p{N}'_])(to)\s*$/iu;
const FILL_ARTICLE_PATTERN = /^(a|an|the)(?:\s+|$)/iu;
const FILL_INFINITIVE_PATTERN = /^(to)(?:\s+|$)/iu;

// This is deliberately an orthographic allowlist, not a claim that every
// generated form is pedagogically appropriate for every sense. A dictionary
// service can add verified forms later, but model supplied strings do not
// become trusted inflections merely by appearing in this field.
const IRREGULAR_INFLECTIONS: Readonly<Record<string, readonly string[]>> = {
  be: ["am", "is", "are", "was", "were", "been", "being"],
  go: ["goes", "went", "gone", "going"],
  do: ["does", "did", "done", "doing"],
  have: ["has", "had", "having"],
  take: ["takes", "took", "taken", "taking"],
  buy: ["buys", "bought", "buying"],
  bring: ["brings", "brought", "bringing"],
  come: ["comes", "came", "coming"],
  see: ["sees", "saw", "seen", "seeing"],
  make: ["makes", "made", "making"],
  say: ["says", "said", "saying"],
  tell: ["tells", "told", "telling"],
  get: ["gets", "got", "gotten", "getting"],
  give: ["gives", "gave", "given", "giving"],
  find: ["finds", "found", "finding"],
  think: ["thinks", "thought", "thinking"],
  know: ["knows", "knew", "known", "knowing"],
  write: ["writes", "wrote", "written", "writing"],
  read: ["reads", "read", "reading"],
  run: ["runs", "ran", "run", "running"],
  eat: ["eats", "ate", "eaten", "eating"],
  drink: ["drinks", "drank", "drunk", "drinking"],
  speak: ["speaks", "spoke", "spoken", "speaking"],
  teach: ["teaches", "taught", "teaching"],
  learn: ["learns", "learnt", "learned", "learning"],
  leave: ["leaves", "left", "leaving"],
  feel: ["feels", "felt", "feeling"],
  keep: ["keeps", "kept", "keeping"],
  sleep: ["sleeps", "slept", "sleeping"],
  sell: ["sells", "sold", "selling"],
  send: ["sends", "sent", "sending"],
  pay: ["pays", "paid", "paying"],
  meet: ["meets", "met", "meeting"],
  put: ["puts", "put", "putting"],
  cut: ["cuts", "cut", "cutting"],
  win: ["wins", "won", "winning"],
  lose: ["loses", "lost", "losing"],
  choose: ["chooses", "chose", "chosen", "choosing"],
  begin: ["begins", "began", "begun", "beginning"],
  become: ["becomes", "became", "become", "becoming"],
  understand: ["understands", "understood", "understanding"],
  show: ["shows", "showed", "shown", "showing"],
  hold: ["holds", "held", "holding"],
  build: ["builds", "built", "building"],
  break: ["breaks", "broke", "broken", "breaking"],
  drive: ["drives", "drove", "driven", "driving"],
  ride: ["rides", "rode", "ridden", "riding"],
  fly: ["flies", "flew", "flown", "flying"],
  swim: ["swims", "swam", "swum", "swimming"],
  sing: ["sings", "sang", "sung", "singing"],
  stand: ["stands", "stood", "standing"],
  sit: ["sits", "sat", "sitting"],
  prefer: ["prefers", "preferred", "preferring"],
  child: ["children"],
  person: ["people"],
  man: ["men"],
  woman: ["women"],
  mouse: ["mice"],
  goose: ["geese"],
  tooth: ["teeth"],
  foot: ["feet"],
};

function emptyMetrics(): LessonValidationMetrics {
  return {
    wordCount: 0,
    sentenceCount: 0,
    maxSentenceWords: 0,
    targetOccurrences: {},
    practiceExposure: {},
  };
}

function issue(
  code: string,
  path: Array<string | number>,
  message: string,
): ContractValidationIssue {
  return { code, path, message };
}

export function normalizeMatchText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201B\u02BC\uFF07]/gu, "'")
    .toLocaleLowerCase("en-US")
    .trim()
    .replace(/\s+/gu, " ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isAsciiLexicalWord(value: string): boolean {
  return /^[a-z]+$/u.test(value);
}

function isConsonant(value: string): boolean {
  return /^[^aeiou]$/u.test(value);
}

function shouldDoubleFinalConsonant(word: string): boolean {
  if (word.length < 3) return false;
  const last = word.at(-1) ?? "";
  const previous = word.at(-2) ?? "";
  const beforePrevious = word.at(-3) ?? "";
  return isConsonant(last)
    && !/[wxy]/u.test(last)
    && /[aeiou]/u.test(previous)
    && isConsonant(beforePrevious);
}

function generateSingleWordForms(word: string): Set<string> {
  const normalized = normalizeMatchText(word);
  const forms = new Set<string>([normalized]);
  if (!isAsciiLexicalWord(normalized)) return forms;

  const irregularForms = IRREGULAR_INFLECTIONS[normalized];
  if (irregularForms) {
    for (const form of irregularForms) forms.add(form);
    return forms;
  }

  if (normalized.endsWith("y") && normalized.length > 1 && isConsonant(normalized.at(-2) ?? "")) {
    forms.add(`${normalized.slice(0, -1)}ies`);
  } else if (/[sxz]$/u.test(normalized) || /(ch|sh)$/u.test(normalized) || normalized.endsWith("o")) {
    forms.add(`${normalized}es`);
  } else {
    forms.add(`${normalized}s`);
  }

  if (normalized.endsWith("e")) {
    forms.add(`${normalized}d`);
  } else if (normalized.endsWith("y") && normalized.length > 1 && isConsonant(normalized.at(-2) ?? "")) {
    forms.add(`${normalized.slice(0, -1)}ied`);
  } else {
    forms.add(`${normalized}ed`);
  }

  if (normalized.endsWith("ie")) {
    forms.add(`${normalized.slice(0, -2)}ying`);
  } else if (normalized.endsWith("e") && !normalized.endsWith("ee") && !normalized.endsWith("ye")) {
    forms.add(`${normalized.slice(0, -1)}ing`);
  } else {
    forms.add(`${normalized}ing`);
  }

  if (shouldDoubleFinalConsonant(normalized)) {
    const final = normalized.at(-1);
    forms.add(`${normalized}${final}ed`);
    forms.add(`${normalized}${final}ing`);
  }
  return forms;
}

function generateDeterministicInflections(term: string): Set<string> {
  const normalized = normalizeMatchText(term);
  const forms = new Set<string>([normalized]);
  const words = normalized.split(" ");
  const firstWord = words.findIndex((word) => /[a-z]/u.test(word));
  if (firstWord < 0) return forms;

  const firstWordForms = generateSingleWordForms(words[firstWord]);
  for (const firstForm of firstWordForms) {
    const inflectedWords = [...words];
    inflectedWords[firstWord] = firstForm;
    forms.add(inflectedWords.join(" "));
  }
  return forms;
}

function resolveTargetMatchVariants(target: LearningTarget): {
  variants: string[];
  invalidInflections: string[];
} {
  const deterministicForms = generateDeterministicInflections(target.term);
  const normalizedTerm = normalizeMatchText(target.term);
  const explicitInflections = target.inflections ?? [];
  const variants = new Set<string>([normalizedTerm]);
  const invalidInflections: string[] = [];
  for (const inflection of explicitInflections) {
    const normalizedInflection = normalizeMatchText(inflection);
    // Possessives are only accepted when the caller explicitly supplies the
    // variant. The base term must not match the possessive through a loose
    // apostrophe boundary.
    const possessiveStem = normalizedInflection.endsWith("'s")
      ? normalizedInflection.slice(0, -2)
      : normalizedInflection.endsWith("s'")
        ? normalizedInflection.slice(0, -1)
        : "";
    const explicitPossessive = /^[a-z]+(?:'s|s')$/u.test(normalizedInflection)
      && possessiveStem === normalizedTerm;
    if (deterministicForms.has(normalizedInflection) || explicitPossessive) {
      variants.add(normalizedInflection);
    } else {
      invalidInflections.push(inflection);
    }
  }
  return { variants: [...variants], invalidInflections };
}

function buildWholeTermPattern(variants: string[]): RegExp | null {
  const normalizedVariants = [...new Set(variants
    .map(normalizeMatchText)
    .filter(Boolean))]
    .sort((left, right) => right.length - left.length)
    .map((variant) => escapeRegex(variant).replace(/\\ /gu, "\\s+"));
  if (normalizedVariants.length === 0) return null;
  const lexicalBoundary = "\\p{L}\\p{N}_'";
  const alternatives = normalizedVariants.flatMap((variant) => [
    `(?<![${lexicalBoundary}])${variant}(?![${lexicalBoundary}])`,
    `(?<![${lexicalBoundary}])'${variant}'(?![${lexicalBoundary}])`,
  ]);
  return new RegExp(`(?:${alternatives.join("|")})`, "gu");
}

function countWholeTermOccurrences(text: string, variants: string[]): number {
  const pattern = buildWholeTermPattern(variants);
  if (!pattern) return 0;
  const normalizedText = normalizeMatchText(text);
  return [...normalizedText.matchAll(pattern)].length;
}

function splitSentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])\s+|\r?\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function storyLanguageAssessment(text: string): {
  clearlyVietnamese: boolean;
  uncertain: boolean;
} {
  const tokens = (normalizeMatchText(text).match(WORD_PATTERN) ?? []);
  const englishFunctionCount = tokens.filter((token) => ENGLISH_FUNCTION_WORDS.has(token)).length;
  const vietnameseFunctionCount = tokens.filter((token) => VIETNAMESE_FUNCTION_WORDS.has(token)).length;
  const diacriticCount = (text.toLocaleLowerCase("vi").match(VIETNAMESE_DIACRITICS) ?? []).length;
  const clearlyVietnamese = tokens.length >= 4
    && diacriticCount >= 2
    && vietnameseFunctionCount >= 1
    && englishFunctionCount === 0;
  const uncertain = !clearlyVietnamese
    && (englishFunctionCount === 0 || (diacriticCount > 0 && vietnameseFunctionCount > 0));
  return { clearlyVietnamese, uncertain };
}

function targetIdentity(target: LearningTarget): string {
  return `${normalizeMatchText(target.term)}\u0000${normalizeMatchText(target.sense)}`;
}

function addDuplicateTargetIssues(brief: LessonBrief, issues: ContractValidationIssue[]): void {
  const seen = new Map<string, number>();
  for (const [index, target] of brief.targets.entries()) {
    const identity = targetIdentity(target);
    const previousIndex = seen.get(identity);
    if (previousIndex !== undefined) {
      issues.push(issue(
        "duplicate_target",
        ["brief", "targets", index],
        `target duplicates brief target at index ${previousIndex} after term and sense normalization`,
      ));
    }
    seen.set(identity, index);
  }
}

function addDuplicateKeywordIssues(brief: LessonBrief, issues: ContractValidationIssue[]): void {
  const seen = new Map<string, number>();
  for (const [index, keyword] of (brief.keywords ?? []).entries()) {
    const normalized = normalizeMatchText(keyword);
    const previousIndex = seen.get(normalized);
    if (previousIndex !== undefined) {
      issues.push(issue(
        "duplicate_keyword",
        ["brief", "keywords", index],
        `keyword duplicates brief keyword at index ${previousIndex}`,
      ));
    }
    seen.set(normalized, index);
  }
}

function computeMetrics(
  draft: LessonDraft,
  targets: LearningTarget[],
  targetVariants: Map<string, string[]>,
): LessonValidationMetrics {
  const storyText = draft.sections.map((section) => section.text).join("\n");
  const sentences = splitSentences(storyText);
  const targetOccurrences: Record<string, number> = {};
  const practiceExposure: Record<string, number> = {};
  for (const target of targets) {
    targetOccurrences[target.id] = countWholeTermOccurrences(
      storyText,
      targetVariants.get(target.id) ?? [target.term],
    );
    practiceExposure[target.id] = 0;
  }
  return {
    wordCount: countWords(storyText),
    sentenceCount: sentences.length,
    maxSentenceWords: sentences.reduce(
      (max, sentence) => Math.max(max, countWords(sentence)),
      0,
    ),
    targetOccurrences,
    practiceExposure,
  };
}

function exerciseBindingText(exercise: Exercise): string {
  switch (exercise.kind) {
    case "meaning":
      return [exercise.prompt, ...exercise.choices.map((choice) => choice.text)].join(" ");
    case "fill":
      return [exercise.prompt, ...exercise.acceptedAnswers].join(" ");
    case "order":
      return [exercise.prompt, ...exercise.tokens.map((token) => token.text)].join(" ");
    case "retell":
      return "";
  }
}

type FillBlankPrefixContext = {
  kind: "determiner" | "possessive" | "infinitive";
  suppliedPhrase: string;
};

function findFillBlankPrefixContext(
  prompt: string,
  blankStart: number,
): FillBlankPrefixContext | null {
  const prefix = prompt.slice(0, blankStart);
  const determinerMatch = prefix.match(FILL_NOUN_PHRASE_PREFIX_PATTERN);
  if (determinerMatch) {
    const determiner = determinerMatch[1].toLocaleLowerCase("en-US");
    const adjective = determinerMatch[2]?.toLocaleLowerCase("en-US");
    return {
      kind: "determiner",
      suppliedPhrase: [determiner, adjective].filter(Boolean).join(" "),
    };
  }
  const possessiveMatch = prefix.match(FILL_POSSESSIVE_PREFIX_PATTERN);
  if (possessiveMatch) {
    return {
      kind: "possessive",
      suppliedPhrase: `${possessiveMatch[1]}'s`,
    };
  }
  const infinitiveMatch = prefix.match(FILL_INFINITIVE_PREFIX_PATTERN);
  if (!infinitiveMatch) return null;
  return {
    kind: "infinitive",
    suppliedPhrase: infinitiveMatch[1].toLocaleLowerCase("en-US"),
  };
}

function addFillAnswerPrefixIssues(
  draft: LessonDraft,
  issues: ContractValidationIssue[],
): void {
  for (const [exerciseIndex, exercise] of draft.exercises.entries()) {
    if (exercise.kind !== "fill") continue;

    const blankContexts = [...exercise.prompt.matchAll(FILL_BLANK_PATTERN)]
      .map((blank) => typeof blank.index === "number"
        ? findFillBlankPrefixContext(exercise.prompt, blank.index)
        : null)
      .filter((context): context is FillBlankPrefixContext => context !== null);
    if (blankContexts.length === 0) continue;

    for (const [answerIndex, answer] of exercise.acceptedAnswers.entries()) {
      const normalizedAnswer = normalizeMatchText(answer);
      const context = blankContexts.find((candidate) => normalizedAnswer.match(
        candidate.kind === "infinitive" ? FILL_INFINITIVE_PATTERN : FILL_ARTICLE_PATTERN,
      ));
      if (!context) continue;
      const answerMatch = normalizedAnswer.match(
        context.kind === "infinitive" ? FILL_INFINITIVE_PATTERN : FILL_ARTICLE_PATTERN,
      );
      if (!answerMatch) continue;
      issues.push(issue(
        context.kind === "infinitive"
          ? "fill_answer_repeats_infinitive_marker"
          : "fill_answer_leading_article",
        ["draft", "exercises", exerciseIndex, "acceptedAnswers", answerIndex],
        context.kind === "infinitive"
          ? `accepted answer "${answer}" starts with infinitive marker "${answerMatch[1]}" after the prompt already supplies "${context.suppliedPhrase}" before the blank; remove the repeated marker so the answer fills only the blank`
          : `accepted answer "${answer}" starts with article "${answerMatch[1]}" after the prompt already supplies ${context.kind === "possessive" ? "possessive name" : "noun phrase"} "${context.suppliedPhrase}" before the blank; remove the leading article so the answer fills only the blank`,
      ));
    }
  }
}

function addAmbiguousAnswerIssues(
  draft: LessonDraft,
  issues: ContractValidationIssue[],
): void {
  for (const [exerciseIndex, exercise] of draft.exercises.entries()) {
    const values = exercise.kind === "meaning"
      ? exercise.choices.map((choice) => ({ value: choice.text, path: ["choices"] as const }))
      : exercise.kind === "fill"
        ? exercise.acceptedAnswers.map((value) => ({ value, path: ["acceptedAnswers"] as const }))
        : [];
    const seen = new Map<string, number>();
    for (const [valueIndex, entry] of values.entries()) {
      const normalized = normalizeMatchText(entry.value);
      const previousIndex = seen.get(normalized);
      if (previousIndex !== undefined) {
        issues.push(issue(
          "ambiguous_answers",
          ["draft", "exercises", exerciseIndex, ...entry.path, valueIndex],
          `answer text duplicates answer at index ${previousIndex} after case and whitespace normalization`,
        ));
      }
      seen.set(normalized, valueIndex);
    }
  }
}

function addExerciseBindingIssues(
  draft: LessonDraft,
  brief: LessonBrief,
  targetVariants: Map<string, string[]>,
  metrics: LessonValidationMetrics,
  issues: ContractValidationIssue[],
): void {
  const targetsById = new Map(brief.targets.map((target) => [target.id, target]));
  for (const [exerciseIndex, exercise] of draft.exercises.entries()) {
    if (exercise.kind === "meaning" && exercise.targetIds.length !== 1) {
      issues.push(issue(
        "meaning_target_ambiguous",
        ["draft", "exercises", exerciseIndex, "targetIds"],
        "meaning exercises must identify exactly one target because choices have no per-target mapping",
      ));
      continue;
    }
    if (exercise.kind === "retell") {
      for (const targetId of new Set(exercise.targetIds)) {
        if (targetId in metrics.practiceExposure) metrics.practiceExposure[targetId] += 1;
      }
      continue;
    }

    const bindingText = exerciseBindingText(exercise);
    for (const targetId of new Set(exercise.targetIds)) {
      const target = targetsById.get(targetId);
      if (!target) continue;
      const variants = targetVariants.get(targetId) ?? [target.term];
      if (countWholeTermOccurrences(bindingText, variants) < 1) {
        issues.push(issue(
          "exercise_target_missing",
          ["draft", "exercises", exerciseIndex, "targetIds"],
          `exercise does not contain the claimed target in its prompt or answer content: ${target.term}`,
        ));
        continue;
      }
      metrics.practiceExposure[targetId] += 1;
    }
  }
}

function addInflectionIssues(
  brief: LessonBrief,
  targetVariants: Map<string, string[]>,
  issues: ContractValidationIssue[],
): void {
  for (const [index, target] of brief.targets.entries()) {
    const matchInfo = resolveTargetMatchVariants(target);
    targetVariants.set(target.id, matchInfo.variants);
    for (const [inflectionIndex, inflection] of (target.inflections ?? []).entries()) {
      if (matchInfo.invalidInflections.includes(inflection)) {
        issues.push(issue(
          "unverified_inflection",
          ["brief", "targets", index, "inflections", inflectionIndex],
          `inflection is not a deterministic form of ${target.term}: ${inflection}`,
        ));
      }
    }
  }
}

function addTargetCoverageIssues(
  draft: LessonDraft,
  brief: LessonBrief,
  metrics: LessonValidationMetrics,
  issues: ContractValidationIssue[],
  targetVariants: Map<string, string[]>,
): void {
  const targetsById = new Map(brief.targets.map((target) => [target.id, target]));
  for (const [index, target] of brief.targets.entries()) {
    if (metrics.targetOccurrences[target.id] < 1) {
      issues.push(issue(
        "target_story_missing",
        ["brief", "targets", index, "term"],
        `target does not occur as a whole English term in the story: ${target.term}`,
      ));
    }
  }
  for (const [sectionIndex, section] of draft.sections.entries()) {
    for (const [targetIndex, targetId] of section.targetIds.entries()) {
      const target = targetsById.get(targetId);
      if (!target) continue;
      if (countWholeTermOccurrences(
        section.text,
        targetVariants.get(target.id) ?? [target.term],
      ) < 1) {
        issues.push(issue(
          "section_target_missing",
          ["draft", "sections", sectionIndex, "targetIds", targetIndex],
          `section claims target without an exact occurrence: ${target.term}`,
        ));
      }
    }
  }
}

function addPracticeIssues(
  draft: LessonDraft,
  brief: LessonBrief,
  metrics: LessonValidationMetrics,
  issues: ContractValidationIssue[],
): void {
  for (const [index, target] of brief.targets.entries()) {
    if (metrics.practiceExposure[target.id] < 2) {
      issues.push(issue(
        "practice_coverage_missing",
        ["brief", "targets", index, "id"],
        `target needs at least two practice exercise exposures: ${target.id}`,
      ));
    }
  }
  const presentKinds = new Set(draft.exercises.map((exercise: Exercise) => exercise.kind));
  for (const kind of REQUIRED_EXERCISE_KINDS) {
    if (!presentKinds.has(kind)) {
      issues.push(issue(
        "exercise_kind_missing",
        ["draft", "exercises"],
        `ready lesson requires an exercise of kind ${kind}`,
      ));
    }
  }
}

function addLanguageIssues(
  storyText: string,
  issues: ContractValidationIssue[],
  warnings: ContractValidationIssue[],
): void {
  const assessment = storyLanguageAssessment(storyText);
  if (assessment.clearlyVietnamese) {
    issues.push(issue(
      "story_language_mismatch",
      ["draft", "sections"],
      "story has strong Vietnamese language signals and is not sufficiently English",
    ));
  } else if (assessment.uncertain) {
    warnings.push(issue(
      "story_language_uncertain",
      ["draft", "sections"],
      "story language is uncertain from the deterministic lexical heuristic",
    ));
  }
}

function addCefrWarnings(
  brief: LessonBrief,
  metrics: LessonValidationMetrics,
  warnings: ContractValidationIssue[],
): void {
  const rubric = getCefrRubric(brief.level, brief.length);
  const [minimumWords, maximumWords] = rubric.wordRange;
  if (metrics.wordCount < minimumWords || metrics.wordCount > maximumWords) {
    warnings.push(issue(
      "cefr_length_outside_rubric",
      ["draft", "sections"],
      `story has ${metrics.wordCount} words; ${brief.level} ${brief.length} guidance is ${minimumWords}-${maximumWords}`,
    ));
  }
  if (metrics.maxSentenceWords > rubric.maxSentenceWords) {
    warnings.push(issue(
      "cefr_sentence_length_above_rubric",
      ["draft", "sections"],
      `longest sentence has ${metrics.maxSentenceWords} words; guidance is at most ${rubric.maxSentenceWords}`,
    ));
  }
  const requestedLevelIndex = CEFR_LEVEL_ORDER.indexOf(brief.level);
  for (const [index, target] of brief.targets.entries()) {
    const knownLevel = getCuratedTargetLevel(target.term);
    if (knownLevel && CEFR_LEVEL_ORDER.indexOf(knownLevel) > requestedLevelIndex) {
      warnings.push(issue(
        "target_above_requested_level",
        ["brief", "targets", index, "term"],
        `curated vocabulary evidence places ${target.term} at ${knownLevel}, above requested ${brief.level}`,
      ));
    }
  }
}

export function evaluateLessonDraft(
  draftInput: unknown,
  briefInput: unknown,
): LessonValidationResult {
  const structuralResult = validateLessonDraft(draftInput, briefInput);
  if (!structuralResult.ok) {
    return {
      ok: false,
      issues: structuralResult.issues,
      warnings: [],
      metrics: emptyMetrics(),
    };
  }

  const briefResult = LessonBriefSchema.safeParse(briefInput);
  if (!briefResult.success) {
    return {
      ok: false,
      issues: [issue(
        "brief_schema_invalid",
        ["brief"],
        "brief could not be parsed after canonical validation",
      )],
      warnings: [],
      metrics: emptyMetrics(),
    };
  }

  const draft = structuralResult.data;
  const brief = briefResult.data;
  const issues: ContractValidationIssue[] = [];
  const warnings: ContractValidationIssue[] = [];
  const targetVariants = new Map<string, string[]>();
  addInflectionIssues(brief, targetVariants, issues);
  const metrics = computeMetrics(draft, brief.targets, targetVariants);
  const storyText = draft.sections.map((section) => section.text).join("\n");

  if (draft.scenes.length !== brief.imageCount) {
    issues.push(issue(
      "scene_count_mismatch",
      ["draft", "scenes"],
      `draft contains ${draft.scenes.length} scenes but brief requests ${brief.imageCount}`,
    ));
  }
  addDuplicateTargetIssues(brief, issues);
  addDuplicateKeywordIssues(brief, issues);
  addAmbiguousAnswerIssues(draft, issues);
  addFillAnswerPrefixIssues(draft, issues);
  addExerciseBindingIssues(draft, brief, targetVariants, metrics, issues);
  addTargetCoverageIssues(draft, brief, metrics, issues, targetVariants);
  addPracticeIssues(draft, brief, metrics, issues);
  addLanguageIssues(storyText, issues, warnings);
  addCefrWarnings(brief, metrics, warnings);

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    metrics,
    data: draft,
  };
}
