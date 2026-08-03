const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
  },
  companyName: String,

  // Alert Details
  title: String,
  description: String,
  type: {
    type: String,
    enum: ['signal', 'news', 'earnings', 'hiring', 'price_change', 'custom'],
    default: 'signal',
  },

  // Alert Configuration
  triggerType: {
    type: String,
    enum: ['price_threshold', 'signal_type', 'keyword', 'all_signals'],
  },
  triggerValue: String,

  // Status
  isActive: {
    type: Boolean,
    default: true,
  },
  isRead: {
    type: Boolean,
    default: false,
  },

  // Notification Settings
  notifyBy: {
    email: { type: Boolean, default: true },
    inApp: { type: Boolean, default: true },
    sms: { type: Boolean, default: false },
  },

  // Metadata
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  triggeredAt: Date,
});

module.exports = mongoose.model('Alert', alertSchema);
