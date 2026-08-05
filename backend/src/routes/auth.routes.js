const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Organization = require('../models/Organization');
const DemoRequest = require('../models/DemoRequest');
const {
  authenticate,
  resolveOrganizationByEmail,
  normalizeDomain,
  domainFromEmail,
} = require('../middleware/auth');

const router = express.Router();

function issueToken(user) {
  return jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map(v => v.trim()).filter(Boolean);
  }
  return [];
}

// Sent back alongside the user so the client can render org context without a
// second round trip.
async function authPayload(user) {
  const organization = user.organizationId
    ? await Organization.findById(user.organizationId)
    : null;

  return {
    token: issueToken(user),
    user: user.toJSON(),
    organization,
  };
}

// ---------------------------------------------------------------------------
// Company registration - creates the tenant plus its first (owner) account
// ---------------------------------------------------------------------------
router.post('/register-organization', async (req, res) => {
  try {
    const {
      // Admin
      firstName, lastName, email, password, jobTitle,
      // Company
      companyName, website, industry, headquarters, description,
      capabilities, capabilityNotes, valuePropositions, differentiators, proofPoints,
      targetIndustries, targetDepartments, targetRoles,
      domains,
    } = req.body;

    if (!firstName || !lastName || !email || !password || !companyName) {
      return res.status(400).json({ error: 'Admin name, work email, password and company name are required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const adminDomain = domainFromEmail(normalizedEmail);

    if (!adminDomain) {
      return res.status(400).json({ error: 'A valid work email is required' });
    }

    const freeMail = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com'];
    if (freeMail.includes(adminDomain)) {
      return res.status(400).json({ error: 'Please register with a company email address, not a personal one' });
    }

    // The admin's own domain always entitles a seat; extra domains are optional
    const domainList = Array.from(new Set([
      adminDomain,
      ...toStringArray(domains).map(normalizeDomain),
    ].filter(Boolean)));

    const domainTaken = await Organization.findOne({ domains: { $in: domainList } });
    if (domainTaken) {
      return res.status(409).json({
        error: `@${adminDomain} is already registered to ${domainTaken.name}. Create an employee account instead.`,
        code: 'ORG_EXISTS',
      });
    }

    if (await User.findOne({ email: normalizedEmail })) {
      return res.status(409).json({ error: 'That email already has an account' });
    }

    const capabilityList = toStringArray(capabilities);
    if (capabilityList.length === 0) {
      return res.status(400).json({ error: 'Add at least one capability so reports can be tailored to what you sell' });
    }

    const organization = new Organization({
      name: companyName,
      domains: domainList,
      website,
      industry,
      headquarters,
      description,
      capabilities: capabilityList,
      capabilityNotes,
      valuePropositions: toStringArray(valuePropositions),
      differentiators: toStringArray(differentiators),
      proofPoints: toStringArray(proofPoints),
      targetIndustries: toStringArray(targetIndustries),
      targetDepartments: toStringArray(targetDepartments),
      targetRoles: toStringArray(targetRoles),
    });
    await organization.save();

    const user = new User({
      firstName,
      lastName,
      email: normalizedEmail,
      password,
      jobTitle,
      organizationId: organization._id,
      company: organization.name,
      role: 'owner',
      profile: {
        vertical: toStringArray(targetIndustries)[0],
        verticalCapabilities: capabilityList.slice(0, 6),
        keywords: [],
        targetDepartments: toStringArray(targetDepartments),
        targetRoles: toStringArray(targetRoles),
        completedOnboarding: false,
      },
    });
    await user.save();

    organization.createdBy = user._id;
    await organization.save();

    res.status(201).json({
      message: 'Organization registered',
      ...(await authPayload(user)),
    });
  } catch (error) {
    console.error('Organization registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Domain lookup - lets the signup screen tell the user which company they are
// about to join before they fill anything in
// ---------------------------------------------------------------------------
router.get('/organization-by-domain', async (req, res) => {
  try {
    const domain = normalizeDomain(req.query.domain || domainFromEmail(req.query.email));

    if (!domain) {
      return res.status(400).json({ error: 'domain or email is required' });
    }

    const organization = await Organization.findOne({ domains: domain });

    if (!organization) {
      return res.status(404).json({ registered: false, domain });
    }

    res.json({
      registered: true,
      domain,
      organization: {
        _id: organization._id,
        name: organization.name,
        industry: organization.industry,
        capabilities: organization.capabilities,
        targetIndustries: organization.targetIndustries,
        targetDepartments: organization.targetDepartments,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Email triage - the login screen calls this as the address is typed, and the
// answer decides which of the three doors the visitor is shown: the password
// box, "ask your admin", or the demo form. Doing it here rather than after a
// password attempt means nobody types a password only to be told they have no
// account.
//
// It reports whether an address has an account, which is why it is rate limited
// separately in server.js: the product needs the distinction, but not at a
// speed that makes bulk enumeration practical.
// ---------------------------------------------------------------------------
router.get('/check-email', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    const domain = domainFromEmail(email);

    if (!domain || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid work email address' });
    }

    const organization = await Organization.findOne({ domains: domain });

    if (!organization) {
      return res.json({ status: 'not_registered', domain });
    }

    // Only existence is checked here - nothing about the account is returned,
    // and the password is still verified by /login as usual.
    const hasAccount = await User.exists({ email });

    if (!hasAccount) {
      return res.json({
        status: 'no_account',
        domain,
        organizationName: organization.name,
      });
    }

    res.json({ status: 'ready', domain, organizationName: organization.name });
  } catch (error) {
    console.error('Email check error:', error);
    res.status(500).json({ error: 'Could not check that email. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// Employee signup - only possible once their company is registered
// ---------------------------------------------------------------------------
router.post('/register', resolveOrganizationByEmail, async (req, res) => {
  try {
    const {
      firstName, lastName, email, password, jobTitle,
      vertical, verticalCapabilities, keywords,
      targetDepartments, targetRoles, region,
    } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    if (await User.findOne({ email: normalizedEmail })) {
      return res.status(409).json({ error: 'That email already has an account' });
    }

    const organization = req.organization;

    const seatsUsed = await User.countDocuments({ organizationId: organization._id });
    if (organization.subscription?.seats && seatsUsed >= organization.subscription.seats) {
      return res.status(403).json({
        error: `${organization.name} has used all ${organization.subscription.seats} seats. Ask your admin to add more.`,
      });
    }

    const keywordList = toStringArray(keywords);
    const verticalCapabilityList = toStringArray(verticalCapabilities);

    const user = new User({
      firstName,
      lastName,
      email: normalizedEmail,
      password,
      jobTitle,
      organizationId: organization._id,
      company: organization.name,
      role: 'member',
      profile: {
        vertical,
        verticalCapabilities: verticalCapabilityList,
        keywords: keywordList,
        targetDepartments: toStringArray(targetDepartments).length
          ? toStringArray(targetDepartments)
          : organization.targetDepartments,
        targetRoles: toStringArray(targetRoles).length
          ? toStringArray(targetRoles)
          : organization.targetRoles,
        region,
        // Onboarding is only complete once we have the three inputs that drive
        // report targeting
        completedOnboarding: Boolean(vertical && verticalCapabilityList.length && keywordList.length),
      },
    });

    await user.save();

    res.status(201).json({
      message: 'Account created',
      ...(await authPayload(user)),
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    // Sign-in is the only door into the product, so when there is no account
    // behind the address the response has to say what the next step is. The two
    // outcomes are decided by the email's domain, not by the person: either the
    // company already subscribes (their admin adds the seat) or it does not
    // (they book a demo). Deliberate trade-off: it confirms that an address has
    // no account here, which the previous blanket message hid.
    if (!user) {
      const domain = domainFromEmail(normalizedEmail);

      if (!domain) {
        return res.status(400).json({ error: 'Enter a valid email address' });
      }

      const registeredOrg = await Organization.findOne({ domains: domain });

      if (registeredOrg) {
        return res.status(403).json({
          error: `${registeredOrg.name} is already on SalesMotion, but there is no account for this email yet. Ask your admin to add you.`,
          code: 'ACCOUNT_NOT_PROVISIONED',
          organizationName: registeredOrg.name,
          domain,
        });
      }

      return res.status(404).json({
        error: `No SalesMotion subscription is registered for @${domain}.`,
        code: 'COMPANY_NOT_REGISTERED',
        domain,
      });
    }

    if (!(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const organization = user.organizationId
      ? await Organization.findById(user.organizationId)
      : null;

    if (organization?.subscription?.status === 'cancelled') {
      return res.status(403).json({ error: `The subscription for ${organization.name} is not active.` });
    }

    user.lastLogin = new Date();
    await user.save();

    res.json({
      message: 'Login successful',
      token: issueToken(user),
      user: user.toJSON(),
      organization,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Demo request - the login screen's dead end for someone whose company has not
// registered yet. Lands in the DemoRequest collection for sales to follow up.
// ---------------------------------------------------------------------------
router.post('/demo-request', async (req, res) => {
  try {
    const { email, phone, fullName, companyName, notes } = req.body;

    if (!email || !phone) {
      return res.status(400).json({ error: 'Work email and phone number are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const domain = domainFromEmail(normalizedEmail);

    if (!domain || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Enter a valid work email address' });
    }

    // Loose on purpose: country codes, spaces, dashes and brackets are all fine.
    // We only insist on enough digits to be dialable, so a valid international
    // number is never rejected by an over-tight pattern.
    const phoneDigits = String(phone).replace(/\D/g, '');
    if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      return res.status(400).json({ error: 'Enter a valid phone number we can reach you on' });
    }

    // Someone hitting the button twice should not create two leads. Reuse the
    // open request for this address and note that they asked again.
    const existing = await DemoRequest.findOne({
      email: normalizedEmail,
      status: { $in: ['new', 'contacted'] },
    });

    if (existing) {
      existing.phone = String(phone).trim();
      if (fullName) existing.fullName = String(fullName).trim();
      if (companyName) existing.companyName = String(companyName).trim();
      if (notes) existing.notes = String(notes).trim();
      existing.requestCount += 1;
      await existing.save();

      return res.status(200).json({
        message: 'Request received',
        alreadyRequested: true,
      });
    }

    await DemoRequest.create({
      email: normalizedEmail,
      phone: String(phone).trim(),
      domain,
      fullName: fullName ? String(fullName).trim() : undefined,
      companyName: companyName ? String(companyName).trim() : undefined,
      notes: notes ? String(notes).trim() : undefined,
      source: 'login_page',
    });

    // No lead details echoed back - the client already has everything it needs
    // to render the confirmation, and this endpoint is unauthenticated.
    res.status(201).json({ message: 'Request received', alreadyRequested: false });
  } catch (error) {
    console.error('Demo request error:', error);
    res.status(500).json({ error: 'Could not save your request. Please try again.' });
  }
});

// Current user + tenant
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user.toJSON(), organization: req.organization });
});

// Employee profile - vertical, vertical capabilities, pitch keywords
router.patch('/profile', authenticate, async (req, res) => {
  try {
    const {
      firstName, lastName, jobTitle,
      vertical, verticalCapabilities, keywords,
      targetDepartments, targetRoles, region,
    } = req.body;

    const user = req.user;

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (jobTitle !== undefined) user.jobTitle = jobTitle;

    if (!user.profile) user.profile = {};
    if (vertical !== undefined) user.profile.vertical = vertical;
    if (verticalCapabilities !== undefined) user.profile.verticalCapabilities = toStringArray(verticalCapabilities);
    if (keywords !== undefined) user.profile.keywords = toStringArray(keywords);
    if (targetDepartments !== undefined) user.profile.targetDepartments = toStringArray(targetDepartments);
    if (targetRoles !== undefined) user.profile.targetRoles = toStringArray(targetRoles);
    if (region !== undefined) user.profile.region = region;

    user.profile.completedOnboarding = Boolean(
      user.profile.vertical &&
      user.profile.verticalCapabilities?.length &&
      user.profile.keywords?.length
    );
    user.updatedAt = new Date();

    await user.save();

    res.json({ user: user.toJSON(), organization: req.organization });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/logout', authenticate, (req, res) => {
  // Tokens are stateless; the client discards it. Kept so the UI has one place
  // to call and we can add a denylist later without changing the contract.
  res.json({ message: 'Logout successful' });
});

module.exports = router;
