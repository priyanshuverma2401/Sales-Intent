import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, Copy, Loader2, Sparkles, Trash2, X } from 'lucide-react';
import { apiError, reportsAPI } from '../services/api';
import { cx } from './ui';
import { reasonLabel, Source } from './ReportSections';

// A generated report runs to forty sections. Before a call a rep has one
// question, not forty minutes - so the report gets a mouth.
//
// It answers from the stored report and nothing else (see the server's
// reportQA service for why), which is what lets the answers carry the same
// [n] citation chips as the page itself: every one points at a source the
// report already read.
//
// The thread lives here, in the tab. Nothing anyone asks about an account is
// written down, and reloading the page starts a clean one.

const MAX_QUESTION = 500;

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  citations?: number[];
  /** A failed request renders in the thread rather than as a banner elsewhere:
   *  the question it failed on is the context that makes it make sense. */
  failed?: boolean;
}

export default function AskAnything({ reportId, report }: { reportId: string; report: any }) {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const shellRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const sources: Source[] = report?.sources || [];
  const companyName = report?.companyName || 'this account';

  // Opening a different report is a different conversation
  useEffect(() => {
    setTurns([]);
    setQuestion('');
    setOpen(false);
  }, [reportId]);

  // The panel floats over the report, so anything that reads as "I am done
  // with this" should put it away. The thread survives - reopening picks the
  // conversation back up where it was left.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!shellRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Keep the newest turn in view without yanking the page around it
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  // Starter questions, drawn from what this particular report actually holds -
  // offering "what did their results say?" for an account with no filed
  // results teaches the reader the feature does not work.
  const suggestions = useMemo(() => {
    const evidence = report?.evidence || {};
    const brief = report?.executiveBrief || {};
    const out: string[] = [];

    if (brief.talkingPoints?.length) out.push('What should I open the call with?');
    if (evidence.strategicPrograms?.[0]?.name) {
      out.push(`What is ${evidence.strategicPrograms[0].name} about, and where do we fit into it?`);
    }
    if (evidence.latestResults?.period) {
      out.push(`What did the ${evidence.latestResults.period} results say?`);
    }
    if (evidence.executiveMoves?.length) out.push('Who has just moved, and who should I approach?');
    if (evidence.hiring?.totalRoles) out.push('What are they hiring for, and what does it signal?');
    if (evidence.regulatoryActions?.length) out.push('What regulatory pressure are they under?');
    out.push('Why should they act now rather than next quarter?');
    out.push('What is the strongest objection I will get, and how do I answer it?');

    return out.slice(0, 5);
  }, [report]);

  const send = useCallback(
    async (raw: string) => {
      const asked = raw.trim();
      if (!asked || busy) return;

      // Only clean turns are replayed: sending a failure back as context would
      // ask the model to reason about an error message.
      const history = turns
        .filter((t) => !t.failed)
        .map((t) => ({ role: t.role, content: t.content }));

      setTurns((prev) => [...prev, { role: 'user', content: asked }]);
      setQuestion('');
      setOpen(true);
      setBusy(true);

      try {
        const res = await reportsAPI.ask(reportId, asked, history);
        setTurns((prev) => [
          ...prev,
          { role: 'assistant', content: res.data.answer, citations: res.data.citations },
        ]);
      } catch (err) {
        setTurns((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: apiError(err, 'That question could not be answered just now.'),
            failed: true,
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, reportId, turns]
  );

  const active = open || busy || Boolean(question);

  return (
    <div
      ref={shellRef}
      className="no-print glass sticky top-0 z-30 -mx-6 mb-5 px-6 py-2.5"
    >
      {/* The panel is a sibling of the island, not a child: `.island` clips to
          its own rounded rim to make the sweep work, and a child panel would be
          clipped with it. */}
      <div className="relative">
        <div className={cx('island', active && 'island-active')}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(question);
            }}
            className="flex h-12 items-center gap-2.5 rounded-[calc(1rem-1.5px)] bg-surface pl-3.5 pr-2"
          >
            <Sparkles
              size={17}
              className={cx('shrink-0 text-brand-600', busy && 'animate-pulse')}
              aria-hidden
            />

            <input
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value.slice(0, MAX_QUESTION))}
              onFocus={() => setOpen(true)}
              placeholder={`Ask anything about this ${companyName} report…`}
              aria-label={`Ask anything about this ${companyName} report`}
              // The rim light is the focus indicator here, so the app-wide
              // focus ring is turned off rather than drawn inside it
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:ring-0"
            />

            {question.length > MAX_QUESTION - 80 && (
              <span className="shrink-0 text-2xs tabular-nums text-ink-faint">
                {MAX_QUESTION - question.length}
              </span>
            )}

            {turns.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setTurns([]);
                  setQuestion('');
                  inputRef.current?.focus();
                }}
                title="Clear this conversation"
                className="shrink-0 rounded-lg p-1.5 text-ink-faint transition hover:bg-slate-100 hover:text-ink"
              >
                <Trash2 size={15} />
              </button>
            )}

            <button
              type="submit"
              disabled={busy || !question.trim()}
              aria-label="Ask"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-white shadow-brand transition disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {busy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <ArrowUp size={16} strokeWidth={2.5} />
              )}
            </button>
          </form>
        </div>

        {/* The answer panel overlays the report rather than pushing it down: the
            island keeps one height, so the chapter bar sitting below it never
            moves while a conversation is going on. */}
        {open && (
          <div className="absolute inset-x-0 top-full z-10 pt-2">
            <div className="animate-slide-down overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-pop">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
                <p className="eyebrow text-ink-faint">
                  {turns.length ? `About ${companyName}` : 'Try one of these'}
                </p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="rounded-md p-1 text-ink-faint transition hover:bg-slate-100 hover:text-ink"
                >
                  <X size={14} />
                </button>
              </div>

              <div ref={threadRef} className="max-h-[min(60vh,30rem)] overflow-y-auto px-4 py-3.5">
                {turns.length === 0 ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => send(s)}
                          className="rounded-full border border-slate-200 bg-surface-2 px-3 py-1.5 text-[13px] text-ink-soft transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    <p className="mt-3.5 text-xs leading-relaxed text-ink-muted">
                      Answers come from this report only — the same {sources.length} sources listed
                      at the bottom of the page. Anything the report does not cover, it says so
                      rather than guesses.
                    </p>
                  </>
                ) : (
                  <div className="space-y-4">
                    {turns.map((turn, i) =>
                      turn.role === 'user' ? (
                        <p
                          key={i}
                          className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand-gradient px-3.5 py-2 text-[13.5px] font-medium leading-relaxed text-white"
                        >
                          {turn.content}
                        </p>
                      ) : (
                        <Answer key={i} turn={turn} sources={sources} />
                      )
                    )}

                    {busy && (
                      <div className="flex items-center gap-2.5 text-[13px] text-ink-muted">
                        <span className="flex gap-1" aria-hidden>
                          {[0, 1, 2].map((n) => (
                            <span
                              key={n}
                              className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500"
                              style={{ animationDelay: `${n * 160}ms` }}
                            />
                          ))}
                        </span>
                        Reading the report…
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** One answer, with the citation chips the report itself uses. */
function Answer({ turn, sources }: { turn: Turn; sources: Source[] }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(turn.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (_) {
      // A blocked clipboard is not worth an error state - the text is on screen
    }
  };

  if (turn.failed) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-red-700">
        {turn.content}
      </p>
    );
  }

  return (
    <div className="group">
      <AnswerBody text={turn.content} sources={sources} />
      <button
        type="button"
        onClick={copy}
        className="mt-1.5 inline-flex items-center gap-1.5 text-2xs font-semibold text-ink-faint opacity-0 transition hover:text-brand-600 focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/**
 * Renders the model's plain text: "- " lines become bullets, and every [n]
 * marker becomes the same chip the report body uses, so a claim in an answer
 * is checkable in one click exactly as a claim on the page is.
 */
function AnswerBody({ text, sources }: { text: string; sources: Source[] }) {
  const byIndex = useMemo(() => new Map(sources.map((s) => [s.index, s])), [sources]);

  const lines = text.split('\n').filter((line) => line.trim());

  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const isBullet = /^\s*[-•*]\s+/.test(line);
        const body = isBullet ? line.replace(/^\s*[-•*]\s+/, '') : line;

        return (
          <p
            key={i}
            className={cx(
              'text-[13.5px] leading-relaxed text-ink-soft',
              isBullet && 'flex gap-2'
            )}
          >
            {isBullet && (
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand-500" aria-hidden />
            )}
            <span className="min-w-0">
              <Cited text={body} byIndex={byIndex} />
            </span>
          </p>
        );
      })}
    </div>
  );
}

function Cited({ text, byIndex }: { text: string; byIndex: Map<number, Source> }) {
  // Split on the markers themselves so the surrounding prose is preserved
  // exactly, including a marker the model emitted for a number that is not in
  // this report's source list - that renders as written rather than as a chip
  // pointing nowhere.
  const parts = text.split(/(\[\d+\])/g);

  return (
    <>
      {parts.map((part, i) => {
        const n = /^\[(\d+)\]$/.exec(part);
        if (!n) return <React.Fragment key={i}>{part}</React.Fragment>;

        const source = byIndex.get(Number(n[1]));
        if (!source) return <React.Fragment key={i}>{part}</React.Fragment>;

        const hint = [source.title, reasonLabel(source)].filter(Boolean).join(' — ');

        return source.url ? (
          <a
            key={i}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={hint}
            className="mx-0.5 rounded bg-brand-50 px-1 text-[10px] font-bold text-brand-600 ring-1 ring-inset ring-brand-200 transition hover:bg-brand-100"
          >
            {part}
          </a>
        ) : (
          <a
            key={i}
            href="#sources"
            title={hint}
            className="mx-0.5 rounded bg-slate-100 px-1 text-[10px] font-bold text-ink-faint"
          >
            {part}
          </a>
        );
      })}
    </>
  );
}
