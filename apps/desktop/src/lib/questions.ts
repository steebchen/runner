/** Normalizes ACP form elicitations (Claude's AskUserQuestion, Codex's
 * request_user_input, MCP servers) into a simple list of questions. */

export type QuestionOption = { value: string; label: string; description?: string; preview?: string; isOther?: boolean };

export type Question = {
  key: string;
  header?: string;
  text: string;
  kind: "single" | "multi" | "text" | "boolean" | "number";
  options: QuestionOption[];
  /** Free-text companion field ("Other" / "Add a note"). */
  noteKey?: string;
  noteLabel?: string;
  notePlaceholder?: string;
  secret?: boolean;
};

const OTHER_LABELS = ["none of the above", "other"];

function options(list: any[] | undefined): QuestionOption[] {
  return (list ?? []).map((o: any) => ({
    value: String(o.const ?? o),
    label: String(o.title ?? o.const ?? o),
    description: o.description ?? undefined,
    preview: o._meta?.["_claude/askUserQuestionOption"]?.preview ?? undefined,
    isOther: OTHER_LABELS.includes(String(o.title ?? o.const ?? "").toLowerCase()),
  }));
}

export function parseQuestions(message: string, schema: any): Question[] {
  const props: Record<string, any> = schema?.properties ?? {};
  const keys = Object.keys(props);
  const required: string[] = Array.isArray(schema?.required) ? schema.required : [];
  // Codex lists questions (in order) under `required`; keep the rest in object order.
  const ordered = [...required.filter((k) => k in props), ...keys.filter((k) => !required.includes(k))];

  const noteFor = (key: string): string | undefined =>
    keys.find((k) => props[k]?._meta?.codex?.role === "user_note" && props[k]?._meta?.codex?.questionId === key) ??
    (props[`${key}_custom`] ? `${key}_custom` : undefined);
  const isNote = (key: string) =>
    props[key]?._meta?.codex?.role === "user_note" || (key.endsWith("_custom") && key.slice(0, -"_custom".length) in props);

  const questionKeys = ordered.filter((k) => !isNote(k));
  return questionKeys.map((key) => {
    const p = props[key];
    const codex = !!p._meta?.codex;
    // Codex: title = question, description = header. Claude: the reverse, and
    // a lone question's text is the elicitation message.
    const text = codex ? (p.title ?? key) : (p.description ?? (questionKeys.length === 1 ? message : p.title) ?? key);
    const header = codex ? p.description : p.title;
    let kind: Question["kind"] = "text";
    let opts: QuestionOption[] = [];
    if (p.oneOf) (kind = "single"), (opts = options(p.oneOf));
    else if (p.enum) (kind = "single"), (opts = options(p.enum));
    else if (p.type === "array") (kind = "multi"), (opts = options(p.items?.anyOf ?? p.items?.oneOf ?? p.items?.enum));
    else if (p.type === "boolean") kind = "boolean";
    else if (p.type === "number" || p.type === "integer") kind = "number";
    const noteKey = noteFor(key);
    const note = noteKey ? props[noteKey] : undefined;
    return {
      key,
      header: header && header !== text ? header : undefined,
      text,
      kind,
      options: opts,
      noteKey,
      noteLabel: note ? (codex ? "Add a note" : "Other") : undefined,
      notePlaceholder: note?.description ?? (codex ? "Add a different answer or a note (optional)" : "Type your own answer (optional)"),
      secret: !!p._meta?.codex?.isSecret,
    };
  });
}

export type Answers = Record<string, string | string[] | boolean | number>;

/** The `content` object for an `accept` response. */
export function buildContent(questions: Question[], answers: Answers, notes: Record<string, string>) {
  const content: Record<string, unknown> = {};
  for (const q of questions) {
    const a = answers[q.key];
    if (a !== undefined && a !== "" && !(Array.isArray(a) && a.length === 0)) content[q.key] = a;
    const note = q.noteKey ? notes[q.key]?.trim() : "";
    if (q.noteKey && note) content[q.noteKey] = note;
  }
  return content;
}

export function isAnswered(q: Question, answers: Answers, notes: Record<string, string>) {
  const a = answers[q.key];
  const hasNote = !!notes[q.key]?.trim();
  if (q.kind === "multi") return (Array.isArray(a) && a.length > 0) || hasNote;
  if (q.kind === "boolean") return typeof a === "boolean";
  return (a !== undefined && a !== "") || hasNote;
}
