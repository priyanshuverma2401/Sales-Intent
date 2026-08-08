import React, { useEffect, useMemo, useState } from 'react';
import { ChevronsUp, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { apiError, organizationsAPI } from '../services/api';
import { Alert, Badge, Button, Card, Field, Spinner, TagInput, cx } from './ui';
import {
  COMPANY_CAPABILITY_SUGGESTIONS,
  CONTACT_TITLE_SUGGESTIONS,
  DEPARTMENT_SUGGESTIONS,
  TECHNOLOGY_CATALOG,
  TITLE_KEYWORD_SUGGESTIONS,
  TOPIC_SUGGESTIONS,
  VERTICALS,
} from '../lib/taxonomy';

// The admin half of Settings & focus: everything the whole team's reports and
// signals are built from. One form, one save.

export type TitleRule = { title: string; keywords: string[] };
export type Topic = { name: string; priority: 'normal' | 'high' };

type CompanyForm = {
  name: string;
  website: string;
  industry: string;
  headquarters: string;
  description: string;
  capabilities: string[];
  capabilityNotes: string;
  valuePropositions: string[];
  proofPoints: string[];
  targetIndustries: string[];
  targetDepartments: string[];
  relevantContactTitles: TitleRule[];
  relevantHiringTitles: TitleRule[];
  relevantTopics: Topic[];
  relevantTechnologies: string[];
  productFeatures: string;
  problemsSolved: string;
  outcomesDelivered: string;
  competitorsDifferentiation: string;
  caseStudies: string;
  industryTerminology: string;
};

function toForm(org: any): CompanyForm {
  return {
    name: org?.name || '',
    website: org?.website || '',
    industry: org?.industry || '',
    headquarters: org?.headquarters || '',
    description: org?.description || '',
    capabilities: org?.capabilities || [],
    capabilityNotes: org?.capabilityNotes || '',
    valuePropositions: org?.valuePropositions || [],
    proofPoints: org?.proofPoints || [],
    targetIndustries: org?.targetIndustries || [],
    targetDepartments: org?.targetDepartments || [],
    // Older orgs predate these fields, and a legacy list of plain strings has to
    // keep working, so both shapes are normalised on the way in.
    relevantContactTitles: toTitleRules(org?.relevantContactTitles),
    relevantHiringTitles: toTitleRules(org?.relevantHiringTitles),
    relevantTopics: toTopics(org?.relevantTopics),
    relevantTechnologies: org?.relevantTechnologies || [],
    productFeatures: org?.productFeatures || '',
    problemsSolved: org?.problemsSolved || '',
    outcomesDelivered: org?.outcomesDelivered || '',
    competitorsDifferentiation: org?.competitorsDifferentiation || '',
    caseStudies: org?.caseStudies || '',
    industryTerminology: org?.industryTerminology || '',
  };
}

function toTitleRules(value: any): TitleRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any) =>
      typeof item === 'string'
        ? { title: item, keywords: [] }
        : { title: item?.title || '', keywords: item?.keywords || [] }
    )
    .filter((rule) => rule.title);
}

function toTopics(value: any): Topic[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any) =>
      typeof item === 'string'
        ? { name: item, priority: 'normal' as const }
        : { name: item?.name || '', priority: item?.priority === 'high' ? ('high' as const) : ('normal' as const) }
    )
    .filter((topic) => topic.name);
}

export default function CompanyProfilePanel({
  organization,
  canEdit,
  onSaved,
  onError,
}: {
  organization: any;
  canEdit: boolean;
  onSaved: (organization: any) => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState<CompanyForm>(() => toForm(organization));
  const [saved, setSaved] = useState<CompanyForm>(() => toForm(organization));
  const [saving, setSaving] = useState(false);

  // The org arrives after the session bootstrap, so the form has to re-seed
  // itself rather than stay stuck on the empty first render.
  useEffect(() => {
    const next = toForm(organization);
    setForm(next);
    setSaved(next);
  }, [organization?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<CompanyForm>) => {
    if (!canEdit) return;
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await organizationsAPI.update(form);
      setSaved(toForm(res.data));
      onSaved(res.data);
    } catch (err) {
      onError(apiError(err, 'We could not save your business details'));
    } finally {
      setSaving(false);
    }
  };

  if (!organization) return <Spinner />;

  return (
    <div className="space-y-5 pb-2">
      {!canEdit && (
        <Alert tone="info">
          Only owners and admins can change these details. You can still see what your reports and
          buying signals are built from.
        </Alert>
      )}

      <TitleRulesCard
        title="People worth watching"
        description="Which job titles matter to you? We will flag new hires, departures, role changes and job openings for these roles at the companies you track."
        items={form.relevantContactTitles}
        onChange={(relevantContactTitles) => set({ relevantContactTitles })}
        canEdit={canEdit}
        listId="contact-title-suggestions"
      />

      <TitleRulesCard
        title="Roles they are hiring for"
        description="Job openings we should watch for. You only need to add titles that are not already in “People worth watching” — those are covered automatically."
        items={form.relevantHiringTitles}
        onChange={(relevantHiringTitles) => set({ relevantHiringTitles })}
        canEdit={canEdit}
        listId="hiring-title-suggestions"
      />

      <TopicsCard
        items={form.relevantTopics}
        onChange={(relevantTopics) => set({ relevantTopics })}
        canEdit={canEdit}
      />

      <TechnologiesCard
        value={form.relevantTechnologies}
        onChange={(relevantTechnologies) => set({ relevantTechnologies })}
        canEdit={canEdit}
      />

      <Card className="card-pad">
        <h2 className="mb-1 text-lg font-bold tracking-tight text-ink">Tell us about your company</h2>
        <p className="mb-5 text-[13px] leading-relaxed text-ink-muted">
          The more you share here, the more your reports sound like you. Nothing is compulsory —
          fill in what you can.
        </p>

        <div className="space-y-6">
          <Field label="Your website">
            <input
              className="input"
              placeholder="https://example.com"
              disabled={!canEdit}
              value={form.website}
              onChange={(e) => set({ website: e.target.value })}
            />
          </Field>

          <LongField
            label="What your company does"
            question="What is your company called, and what do you do in a sentence or two?"
            value={form.description}
            onChange={(description) => set({ description })}
            disabled={!canEdit}
          />
          <LongField
            label="What you offer"
            question="What products and services do you sell?"
            value={form.productFeatures}
            onChange={(productFeatures) => set({ productFeatures })}
            disabled={!canEdit}
          />
          <LongField
            label="Problems you solve"
            question="What headaches do your customers come to you with?"
            value={form.problemsSolved}
            onChange={(problemsSolved) => set({ problemsSolved })}
            disabled={!canEdit}
          />
          <LongField
            label="Results you deliver"
            question="What do your customers get out of working with you?"
            value={form.outcomesDelivered}
            onChange={(outcomesDelivered) => set({ outcomesDelivered })}
            disabled={!canEdit}
          />
          <LongField
            label="Who you compete with"
            question="Who else do your buyers consider, and why should they pick you?"
            value={form.competitorsDifferentiation}
            onChange={(competitorsDifferentiation) => set({ competitorsDifferentiation })}
            disabled={!canEdit}
          />
          <LongField
            label="Success stories"
            question="What are your customers saying, and which case studies can you point to?"
            value={form.caseStudies}
            onChange={(caseStudies) => set({ caseStudies })}
            disabled={!canEdit}
          />
          <LongField
            label="Words your industry uses"
            question="Any terms or phrases we should use so reports sound like your team?"
            value={form.industryTerminology}
            onChange={(industryTerminology) => set({ industryTerminology })}
            disabled={!canEdit}
          />
        </div>
      </Card>

      <Card className="card-pad">
        <h2 className="mb-1 text-base font-bold text-ink">The short version</h2>
        <p className="mb-5 text-[13px] leading-relaxed text-ink-muted">
          This is what we score every company against. Reports only make the case for what you list
          here, so keep it to what you genuinely sell.
        </p>

        <div className="space-y-5">
          <Field label="What you sell" required hint="A few words each — add as many as you like.">
            <TagInput
              value={form.capabilities}
              onChange={(capabilities) => set({ capabilities })}
              placeholder="e.g. Intelligent automation"
              suggestions={COMPANY_CAPABILITY_SUGGESTIONS}
            />
          </Field>

          <Field
            label="Anything else worth naming"
            hint="Platforms, tools or methods your team mentions on calls."
          >
            <textarea
              className="input"
              rows={3}
              disabled={!canEdit}
              value={form.capabilityNotes}
              onChange={(e) => set({ capabilityNotes: e.target.value })}
            />
          </Field>

          <Field
            label="Promises you make"
            hint="The result a customer gets, not the service itself."
          >
            <TagInput
              value={form.valuePropositions}
              onChange={(valuePropositions) => set({ valuePropositions })}
              placeholder="e.g. 40% lower cost-to-serve"
            />
          </Field>

          <Field
            label="Proof you can point to"
            hint="Real numbers you can quote. We work these into the pitch section of every report."
          >
            <TagInput
              value={form.proofPoints}
              onChange={(proofPoints) => set({ proofPoints })}
              placeholder="e.g. 85% straight-through processing at a UK insurer"
            />
          </Field>
        </div>
      </Card>

      <Card className="card-pad">
        <h2 className="mb-1 text-base font-bold text-ink">Your details and your buyers</h2>
        <p className="mb-5 text-[13px] leading-relaxed text-ink-muted">
          Where you are based, and the kind of customer you are looking for.
        </p>
        <div className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Your company name">
              <input
                className="input"
                disabled={!canEdit}
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>
            <Field label="Industry">
              <input
                className="input"
                disabled={!canEdit}
                value={form.industry}
                onChange={(e) => set({ industry: e.target.value })}
              />
            </Field>
            <Field label="Where you are based">
              <input
                className="input"
                disabled={!canEdit}
                value={form.headquarters}
                onChange={(e) => set({ headquarters: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Industries you target">
              <TagInput
                value={form.targetIndustries}
                onChange={(targetIndustries) => set({ targetIndustries })}
                placeholder="e.g. Insurance"
                suggestions={VERTICALS}
              />
            </Field>
            <Field label="Departments you sell to">
              <TagInput
                value={form.targetDepartments}
                onChange={(targetDepartments) => set({ targetDepartments })}
                placeholder="e.g. Operations"
                suggestions={DEPARTMENT_SUGGESTIONS}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card className="card-pad">
        <h2 className="mb-4 text-base font-bold text-ink">Your plan</h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="eyebrow text-ink-faint">Plan</dt>
            <dd className="mt-1 text-sm font-semibold capitalize text-ink">
              {organization.subscription?.plan || 'trial'}
            </dd>
          </div>
          <div>
            <dt className="eyebrow text-ink-faint">People</dt>
            <dd className="mt-1 text-sm font-semibold text-ink">
              {organization.seatsUsed ?? '—'} of {organization.subscription?.seats ?? '—'} places
              taken
            </dd>
          </div>
          <div>
            <dt className="eyebrow text-ink-faint">Email domains</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {(organization.domains || []).map((d: string) => (
                <Badge key={d} tone="brand">
                  @{d}
                </Badge>
              ))}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
          Anyone with an email address at one of these domains can set up their own account on your
          plan.
        </p>
      </Card>

      {canEdit && (
        <div className="glass sticky bottom-0 z-10 -mx-1 flex items-center justify-end gap-2 rounded-t-xl border-t border-slate-200 px-3 py-4">
          {dirty && (
            <span className="mr-auto flex items-center gap-2 text-[13px] font-medium text-amber-700">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
              You have unsaved changes
            </span>
          )}
          <Button variant="secondary" disabled={!dirty || saving} onClick={() => setForm(saved)}>
            Discard
          </Button>
          <Button icon={Save} loading={saving} disabled={!dirty} onClick={save}>
            Save changes
          </Button>
        </div>
      )}

      <datalist id="contact-title-suggestions">
        {CONTACT_TITLE_SUGGESTIONS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="hiring-title-suggestions">
        {CONTACT_TITLE_SUGGESTIONS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Long-form narrative section
// ---------------------------------------------------------------------------
function LongField({
  label,
  question,
  value,
  onChange,
  disabled,
}: {
  label: string;
  question: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <h3 className="text-base font-bold text-ink">{label}</h3>
      <p className="mb-2 mt-0.5 text-[13px] text-ink-muted">{question}</p>
      <textarea
        className="input min-h-[180px] leading-relaxed"
        rows={8}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row chrome shared by the three list cards
// ---------------------------------------------------------------------------
function ListCard({
  title,
  description,
  count,
  onAdd,
  canEdit,
  children,
}: {
  title: string;
  description: string;
  count?: number;
  onAdd: () => void;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-5">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-ink">
            {title}
            {typeof count === 'number' && count > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-muted">
                {count}
              </span>
            )}
          </h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-muted">{description}</p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={onAdd}
            aria-label={`Add to ${title}`}
            title={`Add to ${title}`}
            className="btn btn-secondary h-9 w-9 shrink-0 rounded-xl p-0"
          >
            <Plus size={18} />
          </button>
        )}
      </div>
      {/* The list scrolls inside the card past ~7 rows, so a long list never
          pushes the sections below it off the bottom of the page */}
      <div className="max-h-[22rem] overflow-y-auto overscroll-contain border-t border-slate-100">
        <div className="divide-y divide-slate-100">{children}</div>
      </div>
    </Card>
  );
}

function RowActions({
  onEdit,
  onDelete,
  label,
}: {
  onEdit: () => void;
  onDelete: () => void;
  label: string;
}) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${label}`}
        className="rounded-lg p-1.5 text-ink-faint transition hover:bg-slate-100 hover:text-ink active:scale-95"
      >
        <Pencil size={16} />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${label}`}
        className="rounded-lg p-1.5 text-ink-faint transition hover:bg-red-50 hover:text-red-600"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="px-6 py-5 text-[13px] text-ink-muted">{children}</p>;
}

// ---------------------------------------------------------------------------
// Relevant Contact / Hiring Titles
// ---------------------------------------------------------------------------
function TitleRulesCard({
  title,
  description,
  items,
  onChange,
  canEdit,
  listId,
}: {
  title: string;
  description: string;
  items: TitleRule[];
  onChange: (next: TitleRule[]) => void;
  canEdit: boolean;
  listId: string;
}) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<TitleRule>({ title: '', keywords: [] });

  const startAdd = () => {
    setDraft({ title: '', keywords: [] });
    setEditing('new');
  };

  const startEdit = (index: number) => {
    setDraft({ title: items[index].title, keywords: [...items[index].keywords] });
    setEditing(index);
  };

  const commit = () => {
    const clean = { title: draft.title.trim(), keywords: draft.keywords };
    if (!clean.title) return;
    onChange(
      editing === 'new' ? [...items, clean] : items.map((item, i) => (i === editing ? clean : item))
    );
    setEditing(null);
  };

  const editor = (
    <div className="animate-slide-down space-y-4 bg-surface-2 px-6 py-5">
      <Field label="Job title" required hint="The kind of role you want to hear about.">
        <input
          className="input"
          list={listId}
          autoFocus
          placeholder="e.g. Director"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
      </Field>
      <Field
        label="Narrow it down (optional)"
        hint="We will only flag this title when it also mentions one of these words."
      >
        <TagInput
          value={draft.keywords}
          onChange={(keywords) => setDraft({ ...draft, keywords })}
          placeholder="e.g. Operations"
          suggestions={TITLE_KEYWORD_SUGGESTIONS}
        />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" onClick={commit} disabled={!draft.title.trim()}>
          {editing === 'new' ? 'Add title' : 'Update title'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <ListCard
      title={title}
      description={description}
      count={items.length}
      onAdd={startAdd}
      canEdit={canEdit}
    >
      {items.length === 0 && editing !== 'new' && (
        <EmptyRow>Nothing here yet — use the + button to add your first job title.</EmptyRow>
      )}

      {items.map((rule, index) =>
        editing === index ? (
          <div key={`edit-${index}`}>{editor}</div>
        ) : (
          <div key={`${rule.title}-${index}`} className="flex flex-wrap items-start gap-3 px-6 py-4">
            <Badge tone="brand">{rule.title}</Badge>

            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {rule.keywords.length > 0 && (
                <>
                  <span className="text-[13px] text-ink-muted">Only when it mentions:</span>
                  {rule.keywords.map((keyword) => (
                    <span
                      key={keyword}
                      className="rounded bg-slate-100 px-1.5 py-0.5 text-2xs font-semibold text-ink-muted"
                    >
                      {keyword}
                    </span>
                  ))}
                </>
              )}
            </div>

            {canEdit && (
              <RowActions
                label={rule.title}
                onEdit={() => startEdit(index)}
                onDelete={() => onChange(items.filter((_, i) => i !== index))}
              />
            )}
          </div>
        )
      )}

      {editing === 'new' && editor}
    </ListCard>
  );
}

// ---------------------------------------------------------------------------
// Relevant Topics
// ---------------------------------------------------------------------------
function TopicsCard({
  items,
  onChange,
  canEdit,
}: {
  items: Topic[];
  onChange: (next: Topic[]) => void;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<Topic>({ name: '', priority: 'normal' });

  const startAdd = () => {
    setDraft({ name: '', priority: 'normal' });
    setEditing('new');
  };

  const startEdit = (index: number) => {
    setDraft({ ...items[index] });
    setEditing(index);
  };

  const commit = () => {
    const clean: Topic = { name: draft.name.trim(), priority: draft.priority };
    if (!clean.name) return;
    onChange(
      editing === 'new' ? [...items, clean] : items.map((item, i) => (i === editing ? clean : item))
    );
    setEditing(null);
  };

  const unused = TOPIC_SUGGESTIONS.filter(
    (s) => !items.some((t) => t.name.toLowerCase() === s.toLowerCase())
  );

  const editor = (
    <div className="animate-slide-down space-y-4 bg-surface-2 px-6 py-5">
      <Field label="Topic" required hint="A theme, a competitor name, or any phrase worth watching.">
        <input
          className="input"
          autoFocus
          placeholder="e.g. AI transformation"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
      </Field>

      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-brand-600"
          checked={draft.priority === 'high'}
          onChange={(e) => setDraft({ ...draft, priority: e.target.checked ? 'high' : 'normal' })}
        />
        Make this a top priority — we will lead every report with it and push matching news to the
        top
      </label>

      <div className="flex gap-2">
        <Button size="sm" onClick={commit} disabled={!draft.name.trim()}>
          {editing === 'new' ? 'Add topic' : 'Update topic'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
          Cancel
        </Button>
      </div>

      {editing === 'new' && unused.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
            Suggested
          </span>
          {unused.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setDraft({ ...draft, name: s })}
              className="rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-[12px] text-ink-muted transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <ListCard
      title="Topics you care about"
      description="What should we watch for in the news? Add broad themes or specific things like competitor names and industry jargon. Mark the ones that matter most as a top priority and every report will lead with them."
      count={items.length}
      onAdd={startAdd}
      canEdit={canEdit}
    >
      {items.length === 0 && editing !== 'new' && (
        <EmptyRow>Nothing here yet — use the + button to add your first topic.</EmptyRow>
      )}

      {items.map((topic, index) =>
        editing === index ? (
          <div key={`edit-${index}`}>{editor}</div>
        ) : (
          <div key={`${topic.name}-${index}`} className="flex items-center gap-3 px-6 py-3.5">
            <span
              className={cx(
                'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold ring-1 ring-inset',
                topic.priority === 'high'
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                  : 'bg-slate-100 text-ink-muted ring-slate-200'
              )}
            >
              {topic.priority === 'high' && <ChevronsUp size={14} className="text-emerald-600" />}
              {topic.name}
            </span>

            <div className="min-w-0 flex-1" />

            {canEdit && (
              <RowActions
                label={topic.name}
                onEdit={() => startEdit(index)}
                onDelete={() => onChange(items.filter((_, i) => i !== index))}
              />
            )}
          </div>
        )
      )}

      {editing === 'new' && editor}
    </ListCard>
  );
}

// ---------------------------------------------------------------------------
// Relevant Technologies
// ---------------------------------------------------------------------------
function TechnologiesCard({
  value,
  onChange,
  canEdit,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  canEdit: boolean;
}) {
  const [query, setQuery] = useState('');

  const add = (name: string) => {
    const tech = name.trim();
    if (!tech) return;
    if (value.some((v) => v.toLowerCase() === tech.toLowerCase())) {
      setQuery('');
      return;
    }
    onChange([...value, tech]);
    setQuery('');
  };

  // The catalogue is a shortcut, not a whitelist - anything typed is accepted.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TECHNOLOGY_CATALOG.filter(
      (tech) =>
        !value.some((v) => v.toLowerCase() === tech.name.toLowerCase()) &&
        (!q || tech.name.toLowerCase().includes(q))
    ).slice(0, 8);
  }, [query, value]);

  return (
    <Card className="card-pad">
      <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-ink">
        Tools and technology you care about
        {value.length > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-muted">
            {value.length}
          </span>
        )}
      </h2>
      <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-muted">
        Which tools do you want to know about when a company uses them? Pick from the list or type
        your own — product names, competitors and acronyms all work.
      </p>

      {value.length > 0 && (
        // Chips scroll inside a capped strip rather than growing the card
        <div className="mt-4 flex max-h-52 flex-wrap gap-2 overflow-y-auto overscroll-contain pr-1">
          {value.map((tech) => (
            <span
              key={tech}
              className="inline-flex animate-scale-in items-center gap-1.5 rounded-lg bg-brand-50 py-1 pl-2.5 pr-1.5 text-[13px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200"
            >
              {tech}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((t) => t !== tech))}
                  aria-label={`Remove ${tech}`}
                  className="rounded p-0.5 text-brand-500 transition hover:bg-brand-100 hover:text-brand-700"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {canEdit && (
        <>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 px-3 shadow-inset transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10 hover:border-slate-300">
            <Search size={16} className="shrink-0 text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add(query);
                }
              }}
              placeholder="Kafka, Salesforce, Google Analytics…"
              className="min-w-0 flex-1 border-0 bg-transparent py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="shrink-0 rounded p-1 text-ink-faint hover:text-ink"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="mt-2 max-h-72 overflow-y-auto">
            {matches.length === 0 ? (
              <button
                type="button"
                onClick={() => add(query)}
                disabled={!query.trim()}
                className="w-full rounded-lg px-3 py-3 text-left text-[13px] text-ink-muted transition hover:bg-slate-50 disabled:opacity-60"
              >
                {query.trim()
                  ? `Press Enter to add “${query.trim()}” yourself.`
                  : 'You are already watching everything on our list.'}
              </button>
            ) : (
              <ul className="divide-y divide-slate-100">
                {matches.map((tech) => (
                  <li key={tech.name}>
                    <button
                      type="button"
                      onClick={() => add(tech.name)}
                      className="flex w-full items-start gap-3 px-1 py-3 text-left transition hover:bg-slate-50"
                    >
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-ink-muted">
                        {tech.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink">{tech.name}</span>
                        <span className="block truncate text-[13px] text-ink-muted">
                          {tech.description}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
