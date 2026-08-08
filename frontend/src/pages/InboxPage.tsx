import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Inbox as InboxIcon, MailOpen } from 'lucide-react';
import { apiError, inboxAPI } from '../services/api';
import { Alert, Badge, EmptyState, PageHeader, SkeletonRows, cx, stagger } from '../components/ui';

export default function InboxPage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<any[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    inboxAPI
      .getMessages(showArchived)
      .then((res) => setMessages(res.data))
      .catch((err) => setError(apiError(err, 'Could not load your inbox')))
      .finally(() => setLoading(false));
  }, [showArchived]);

  const markRead = async (id: string) => {
    try {
      await inboxAPI.markAsRead(id);
      setMessages((prev) => prev.map((m) => (m._id === id ? { ...m, isRead: true } : m)));
    } catch (err) {
      setError(apiError(err, 'Could not mark as read'));
    }
  };

  const archive = async (id: string) => {
    try {
      await inboxAPI.archive(id);
      setMessages((prev) => prev.filter((m) => m._id !== id));
    } catch (err) {
      setError(apiError(err, 'Could not archive the message'));
    }
  };

  const unread = messages.filter((m) => !m.isRead).length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Notifications"
        title="Inbox"
        description={
          !showArchived && unread > 0
            ? `You have ${unread} unread ${unread === 1 ? 'message' : 'messages'}.`
            : 'Updates about your companies and reports.'
        }
        actions={
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 ring-1 ring-inset ring-slate-200/70">
            {[
              { label: 'Inbox', archived: false },
              { label: 'Archived', archived: true },
            ].map((option) => (
              <button
                key={option.label}
                onClick={() => setShowArchived(option.archived)}
                className={cx(
                  'rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-all duration-200 ease-swift',
                  showArchived === option.archived
                    ? 'bg-surface text-ink shadow-card'
                    : 'text-ink-muted hover:text-ink'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      {error && (
        <div className="mb-5">
          <Alert tone="error" onDismiss={() => setError('')}>
            {error}
          </Alert>
        </div>
      )}

      {loading ? (
        <SkeletonRows rows={3} />
      ) : messages.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title={showArchived ? 'Nothing archived' : 'Your inbox is empty'}
          description={
            showArchived
              ? 'Messages you archive will show up here.'
              : 'Create a report and we will let you know the moment it is ready.'
          }
        />
      ) : (
        <div className="stagger space-y-3">
          {messages.map((message, i) => (
            <div
              key={message._id}
              style={stagger(i)}
              className={cx(
                'card flex items-start gap-4 border-l-[3px] p-5 hover:shadow-raised',
                message.isRead ? 'border-l-slate-200' : 'border-l-brand-500'
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3
                    className={cx(
                      'text-[15px] text-ink',
                      message.isRead ? 'font-semibold' : 'font-bold'
                    )}
                  >
                    {message.title}
                  </h3>
                  {!message.isRead && <Badge tone="brand">New</Badge>}
                </div>

                <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{message.message}</p>

                <div className="mt-2.5 flex flex-wrap items-center gap-3">
                  <span className="text-2xs text-ink-faint">
                    {message.createdAt ? new Date(message.createdAt).toLocaleString() : ''}
                  </span>
                  {message.actionUrl && (
                    <button
                      onClick={() => {
                        if (!message.isRead) markRead(message._id);
                        navigate(message.actionUrl);
                      }}
                      className="group inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600 transition hover:text-brand-700"
                    >
                      {message.actionText || 'Open'}
                      <span className="transition-transform duration-200 group-hover:translate-x-0.5">
                        →
                      </span>
                    </button>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 gap-1">
                {!message.isRead && (
                  <button
                    onClick={() => markRead(message._id)}
                    title="Mark as read"
                    className="rounded-lg p-2 text-ink-faint transition hover:bg-slate-100 hover:text-ink"
                  >
                    <MailOpen size={16} />
                  </button>
                )}
                {!showArchived && (
                  <button
                    onClick={() => archive(message._id)}
                    title="Archive"
                    className="rounded-lg p-2 text-ink-faint transition hover:bg-slate-100 hover:text-ink"
                  >
                    <Archive size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
