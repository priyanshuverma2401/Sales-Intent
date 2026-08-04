import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Inbox as InboxIcon, MailOpen } from 'lucide-react';
import { apiError, inboxAPI } from '../services/api';
import { Alert, Badge, EmptyState, PageHeader, SkeletonRows, cx } from '../components/ui';

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
            ? `${unread} unread ${unread === 1 ? 'notification' : 'notifications'}`
            : 'Updates about your accounts and reports.'
        }
        actions={
          <div className="flex gap-1.5">
            {[
              { label: 'Inbox', archived: false },
              { label: 'Archived', archived: true },
            ].map((option) => (
              <button
                key={option.label}
                onClick={() => setShowArchived(option.archived)}
                className={cx(
                  'rounded-lg px-3.5 py-2 text-[13px] font-semibold transition',
                  showArchived === option.archived
                    ? 'bg-brand-600 text-white'
                    : 'bg-surface text-ink-muted ring-1 ring-slate-200 hover:bg-slate-50'
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
              ? 'Archived notifications will appear here.'
              : 'Generate a report and we will let you know the moment it is ready.'
          }
        />
      ) : (
        <div className="space-y-3">
          {messages.map((message) => (
            <div
              key={message._id}
              className={cx(
                'card flex items-start gap-4 border-l-[3px] p-5',
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
                      className="text-[13px] font-semibold text-brand-600 hover:text-brand-700"
                    >
                      {message.actionText || 'Open'} →
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
