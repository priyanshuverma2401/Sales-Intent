const mongoose = require('mongoose');

const inboxSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
  },

  // Message Details
  title: String,
  message: String,
  type: {
    type: String,
    enum: ['alert', 'notification', 'report_ready', 'signal', 'system'],
    default: 'notification',
  },

  // Status
  isRead: {
    type: Boolean,
    default: false,
  },
  isArchived: {
    type: Boolean,
    default: false,
  },

  // Links
  relatedSignalId: mongoose.Schema.Types.ObjectId,
  relatedReportId: mongoose.Schema.Types.ObjectId,
  relatedAlertId: mongoose.Schema.Types.ObjectId,

  // Action
  actionUrl: String,
  actionText: String,

  // Metadata
  createdAt: {
    type: Date,
    default: Date.now,
  },
  readAt: Date,
});

module.exports = mongoose.model('Inbox', inboxSchema);
