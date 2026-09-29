import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ChevronLeft, MessageCircleQuestion } from "lucide-react";
import { actions, type PendingQuestion } from "../lib/store";
import { buildContent, isAnswered, parseQuestions, type Answers } from "../lib/questions";

/**
 * Walks the user through an agent's questions one at a time: pick with a
 * click, number keys or arrows, type a free-form answer in "Other", then
 * submit. Skip tells the agent the user chose not to answer.
 */
export function QuestionCard({ sessionId, question }: { sessionId: string; question: PendingQuestion }) {
  const questions = useMemo(() => parseQuestions(question.message, question.schema), [question]);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState(0);
  const noteRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const q = questions[step];
  const last = step === questions.length - 1;
  const remaining = useCountdown(question);

  useEffect(() => {
    setCursor(0);
    cardRef.current?.focus();
  }, [step]);

  if (!q) return null;

  const submit = () =>
    actions.answerQuestion(sessionId, question.requestId, { action: "accept", content: buildContent(questions, answers, notes) });
  const skip = () => actions.answerQuestion(sessionId, question.requestId, { action: "decline" });
  const next = () => (last ? submit() : setStep((s) => s + 1));

  const choose = (index: number) => {
    const opt = q.options[index];
    if (!opt) return;
    setCursor(index);
    if (q.kind === "multi") {
      const cur = (answers[q.key] as string[] | undefined) ?? [];
      setAnswers({ ...answers, [q.key]: cur.includes(opt.value) ? cur.filter((v) => v !== opt.value) : [...cur, opt.value] });
      return;
    }
    setAnswers({ ...answers, [q.key]: opt.value });
    // "Other"/"None of the above" needs text; otherwise move on.
    if (opt.isOther) noteRef.current?.focus();
    else if (!last) setTimeout(() => setStep((s) => s + 1), 120);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") {
      if (e.key === "Enter" && isAnswered(q, answers, notes)) {
        e.preventDefault();
        next();
      }
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= q.options.length) {
      e.preventDefault();
      choose(n - 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(q.options.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (q.options.length && !isAnswered(q, answers, notes)) choose(cursor);
      else if (isAnswered(q, answers, notes)) next();
    } else if (e.key === "Backspace" && step > 0) {
      setStep((s) => s - 1);
    }
  };

  const selected = (value: string) => {
    const a = answers[q.key];
    return Array.isArray(a) ? a.includes(value) : a === value;
  };
  const preview = q.options[cursor]?.preview;

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="mb-2 rounded-xl border border-accent/40 bg-elevated shadow-sm outline-none"
    >
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2 text-xs text-muted">
        <MessageCircleQuestion size={13} className="text-accent" />
        <span className="font-medium text-fg">The agent has {questions.length > 1 ? "questions" : "a question"}</span>
        {questions.length > 1 && (
          <span>
            {step + 1} of {questions.length}
          </span>
        )}
        {q.header && <span className="rounded bg-hover px-1.5 py-0.5 text-[11px]">{q.header}</span>}
        <span className="flex-1" />
        {remaining !== null && <span title="The agent continues without an answer after this">Continues in {remaining}s</span>}
      </div>

      <div className="px-3.5 pt-3 pb-2">
        <div className="selectable mb-2.5 text-[14px] leading-snug font-medium">{q.text}</div>

        {q.options.length > 0 && (
          <div className="space-y-1">
            {q.options.map((o, i) => (
              <button
                key={o.value}
                onClick={() => choose(i)}
                onMouseEnter={() => setCursor(i)}
                className={clsx(
                  "flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left",
                  selected(o.value) ? "border-accent bg-accent/10" : i === cursor ? "border-border bg-hover" : "border-border",
                )}
              >
                <span
                  className={clsx(
                    "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-medium",
                    selected(o.value) ? "bg-accent text-accent-fg" : "bg-hover text-muted",
                    q.kind === "single" && "rounded-full",
                  )}
                >
                  {selected(o.value) ? <Check size={12} /> : i < 9 ? i + 1 : ""}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px]">{o.label}</span>
                  {o.description && <span className="block text-xs text-muted">{o.description}</span>}
                </span>
              </button>
            ))}
          </div>
        )}

        {preview && <pre className="selectable mt-2 max-h-48 overflow-auto rounded-md border border-border bg-code p-2.5 font-mono text-[11.5px] whitespace-pre-wrap">{preview}</pre>}

        {(q.kind === "text" || q.kind === "number") && (
          <input
            autoFocus
            type={q.secret ? "password" : q.kind === "number" ? "number" : "text"}
            value={String(answers[q.key] ?? "")}
            onChange={(e) => setAnswers({ ...answers, [q.key]: q.kind === "number" ? Number(e.target.value) : e.target.value })}
            placeholder="Your answer"
            className="selectable w-full rounded-lg border border-border bg-bg px-2.5 py-2 text-[13px] outline-none focus:border-accent"
          />
        )}

        {q.kind === "boolean" && (
          <div className="flex gap-2">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                onClick={() => setAnswers({ ...answers, [q.key]: v })}
                className={clsx("rounded-lg border px-3 py-1.5 text-[13px]", answers[q.key] === v ? "border-accent bg-accent/10" : "border-border hover:bg-hover")}
              >
                {v ? "Yes" : "No"}
              </button>
            ))}
          </div>
        )}

        {q.noteKey && (
          <input
            ref={noteRef}
            value={notes[q.key] ?? ""}
            onChange={(e) => setNotes({ ...notes, [q.key]: e.target.value })}
            placeholder={q.notePlaceholder}
            className="selectable mt-2 w-full rounded-lg border border-border bg-bg px-2.5 py-2 text-[13px] outline-none placeholder:text-faint focus:border-accent"
          />
        )}
      </div>

      <div className="flex items-center gap-2 px-3.5 pb-3">
        {step > 0 && (
          <button onClick={() => setStep((s) => s - 1)} className="flex items-center gap-0.5 rounded-md px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg">
            <ChevronLeft size={12} /> Back
          </button>
        )}
        <button onClick={skip} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg" title="Continue without answering">
          Skip
        </button>
        <span className="flex-1" />
        <span className="text-[11px] text-faint">{q.options.length ? "1–9 to pick · ↵ to continue" : "↵ to continue"}</span>
        <button
          onClick={next}
          disabled={!isAnswered(q, answers, notes) && q.kind !== "multi"}
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-fg disabled:opacity-40"
        >
          {last ? "Submit" : "Next"}
        </button>
      </div>
    </div>
  );
}

function useCountdown(q: PendingQuestion) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!q.autoResolveMs) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [q.autoResolveMs]);
  if (!q.autoResolveMs) return null;
  return Math.max(0, Math.ceil((q.receivedAt + q.autoResolveMs - now) / 1000));
}
