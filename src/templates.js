const { readJSON, writeJSON, BRAND_TEMPLATES_FILE } = require('./storage');
const fs = require('fs-extra');
const path = require('path');
const { DATA_DIR } = require('./config');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

const BUILTIN_CATALOG = [
  {
    id: 'cdc',
    file: 'cdc.html',
    name: 'Crypto.com',
    service: 'Crypto.com',
    category: 'crypto',
    description: 'Assigned representative confirmation',
    subject: 'Verify your assigned representative',
    fromName: 'Crypto.com',
    fromEmail: 'noreply@cryptocom',
    company: 'Crypto.com',
    fields: [
      { key: 'TICKET_NUMBER', label: 'Ticket number', placeholder: '#1835' },
      { key: 'REPRESENTATIVE_NAME', label: 'Representative', placeholder: 'Adam Peck' },
      { key: 'CASE_ID', label: 'Case ID', placeholder: '#1835' },
    ],
    examples: { TICKET_NUMBER: '#1835', REPRESENTATIVE_NAME: 'Adam Peck', CASE_ID: '#1835' },
  },
  {
    id: 'cdc2',
    file: 'cdc2.html',
    name: 'Crypto.com + button',
    service: 'Crypto.com',
    category: 'crypto',
    description: 'Representative confirmation with action link',
    subject: 'Verify your assigned representative',
    fromName: 'Crypto.com',
    fromEmail: 'noreply@cryptocom',
    company: 'Crypto.com',
    hasLink: true,
    fields: [
      { key: 'TICKET_NUMBER', label: 'Ticket number', placeholder: '#1835' },
      { key: 'REPRESENTATIVE_NAME', label: 'Representative', placeholder: 'Adam Peck' },
      { key: 'CASE_ID', label: 'Case ID', placeholder: '#1835' },
      { key: 'BUTTON_TEXT', label: 'Link text', placeholder: 'Check Your Case' },
    ],
    examples: { TICKET_NUMBER: '#1835', REPRESENTATIVE_NAME: 'Adam Peck', CASE_ID: '#1835', BUTTON_TEXT: 'Check Your Case' },
  },
  {
    id: 'nypd',
    file: 'nypd.html',
    name: 'NYPD notice',
    service: 'NYPD',
    category: 'law-enforcement',
    description: 'Investigation notice with case officer',
    subject: 'Investigation Notice - Case {{CASE_REFERENCE}}',
    fromName: 'NYPD - New York Police Department',
    fromEmail: 'investigations@nypd',
    company: 'NYPD',
    needsImage: true,
    cids: [{ cid: 'nypdlogo', file: 'nypd.png' }],
    fields: [
      { key: 'RECIPIENT_NAME', label: 'Recipient name', placeholder: 'Jane Doe' },
      { key: 'CASE_REFERENCE', label: 'Case reference', placeholder: 'CASE-001' },
      { key: 'REPRESENTATIVE_NAME', label: 'Assigned officer', placeholder: 'Jane Doe' },
    ],
    examples: { RECIPIENT_NAME: 'Jane Doe', CASE_REFERENCE: 'CASE-001', REPRESENTATIVE_NAME: 'Jane Doe' },
  },
  {
    id: 'metpolice',
    file: 'metpolice.html',
    name: 'Met Police',
    service: 'Metropolitan Police',
    category: 'law-enforcement',
    description: 'Crime reference confirmation',
    subject: '{{SUBJECT}}',
    fromName: 'Metropolitan Police',
    fromEmail: 'investigations@metpolice',
    company: 'Metropolitan Police',
    needsImage: true,
    cids: [{ cid: 'metlogo', file: 'm.jpg' }],
    fields: [
      { key: 'SUBJECT', label: 'Notice title', placeholder: 'Representative Confirmation' },
      { key: 'CRIME_REFERENCE', label: 'Crime reference', placeholder: 'CRI/5786/26' },
      { key: 'OFFICER_NAME', label: 'Officer', placeholder: 'Matthew Willkins' },
      { key: 'BADGE_NUMBER', label: 'Badge no.', placeholder: '1782EA' },
      { key: 'CALL_DATE', label: 'Call date', placeholder: '04-09-26' },
    ],
    examples: {
      SUBJECT: 'Representative Confirmation',
      CRIME_REFERENCE: 'CRI/5786/26',
      OFFICER_NAME: 'Matthew Willkins',
      BADGE_NUMBER: '1782EA',
      CALL_DATE: '04-09-26',
    },
  },
  {
    id: 'metpolice2',
    file: 'metpolice2.html',
    name: 'Met investigation',
    service: 'Metropolitan Police',
    category: 'law-enforcement',
    description: 'Investigation notice with case status',
    subject: 'Investigation Notice',
    fromName: 'Metropolitan Police',
    fromEmail: 'investigations@metpolice',
    company: 'Metropolitan Police',
    needsImage: true,
    cids: [{ cid: 'metlogo2', file: 'm.jpg' }],
    fields: [
      { key: 'NAME', label: 'Recipient name', placeholder: 'Mohammed Khan' },
      { key: 'CASE_REFERENCE', label: 'Case reference', placeholder: 'CRIS - 131886/26' },
      { key: 'OFFICER_NAME', label: 'Assigned officer', placeholder: 'Donovan Miller' },
      { key: 'STATUS', label: 'Status', placeholder: 'Active' },
      { key: 'CASE_TYPE', label: 'Case type', placeholder: 'Administrative Review' },
    ],
    examples: {
      NAME: 'Mohammed Khan',
      CASE_REFERENCE: 'CRIS - 131886/26',
      OFFICER_NAME: 'Donovan Miller',
      STATUS: 'Active',
      CASE_TYPE: 'Administrative Review',
    },
  },
  {
    id: 'yahoo',
    file: 'yahoo.html',
    name: 'Yahoo case review',
    service: 'Yahoo',
    category: 'support',
    description: 'Support case under review',
    subject: 'Your Case is Under Review',
    fromName: 'Yahoo Support',
    fromEmail: 'noreply@yahoo',
    company: 'Yahoo',
    lockSubject: true,
    fields: [
      { key: 'HEADING', label: 'Heading', placeholder: 'Your Case is Under Review' },
      { key: 'REPRESENTATIVE_NAME', label: 'Representative', placeholder: 'Anderson family' },
      { key: 'CASE_ID', label: 'Case ID', placeholder: '204823' },
      { key: 'BODY', label: 'Message', type: 'textarea', placeholder: 'Your Support Inquiry have been raised. Anderson family has been assigned as support representative for the case.', default: 'Your Support Inquiry have been raised. Anderson family has been assigned as support representative for the case.' },
      { key: 'FOOTER', label: 'Footer', placeholder: 'You received this email to follow up on a recent call with our representative.', default: 'You received this email to follow up on a recent call with our representative.' },
    ],
    examples: {
      HEADING: 'Your Case is Under Review',
      REPRESENTATIVE_NAME: 'Anderson family',
      CASE_ID: '204823',
      BODY: 'Your Support Inquiry have been raised. Anderson family has been assigned as support representative for the case.',
      FOOTER: 'You received this email to follow up on a recent call with our representative.',
    },
  },
];

async function loadTemplateHtml(file) {
  const fp = path.join(TEMPLATES_DIR, file);
  return fs.readFile(fp, 'utf8');
}

async function getBuiltinTemplates() {
  const list = [];
  for (const item of BUILTIN_CATALOG) {
    list.push({
      ...item,
      variables: item.fields.map(f => f.key),
    });
  }
  return list;
}

function getBuiltinTemplatesSync() {
  return BUILTIN_CATALOG.map(item => ({
    ...item,
    variables: item.fields.map(f => f.key),
  }));
}

async function getBuiltinTemplateById(id) {
  const meta = BUILTIN_CATALOG.find(t => t.id === id);
  if (!meta) return null;
  let html = '';
  try {
    html = await loadTemplateHtml(meta.file);
  } catch {
    html = '';
  }
  return {
    ...meta,
    variables: meta.fields.map(f => f.key),
    html,
  };
}

/**
 * Process HTML template with variables
 * Variables use format: {{VARIABLE_NAME}}
 */
function processTemplateVariables(html, variables = {}) {
  let processed = html;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    processed = processed.replace(regex, value || '');
  }
  return processed;
}

// ============ TEMPLATE BUILDERS ============
function buildLedgerHTML(settings) {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
  <head>
    <meta content="width=device-width" name="viewport" />
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta content="IE=edge" http-equiv="X-UA-Compatible" />
    <meta content="telephone=no,address=no,email=no,date=no,url=no" name="format-detection" />
    <style>
      @media (prefers-color-scheme: dark){li::marker{color:#c4c4c4}}
    </style>
  </head>
  <title>${settings.ledgerSubject}</title>
  <style type="text/css">
    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; }
      .mobile-padding { padding: 20px !important; }
      .logo-container { padding: 20px 0 !important; }
      .main-logo { width: 120px !important; height: auto !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#f5f5f5; font-family: Helvetica, Arial, sans-serif; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f5f5f5;">
    <tr>
      <td align="center" style="padding:40px 20px;" class="mobile-padding">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width:600px; width:100%; background-color:#ffffff; border:1px solid #e0e0e0; border-radius:4px;" class="container">
          <tr>
            <td align="center" style="padding:20px 0 30px; background-color:#ffffff;">
              <img src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRZDZR6qiU_f7pR-CtqHam12l0gHGyD95pbpgU6yzE9Ag&s"
                   width="160" height="auto"
                   alt="Ledger Security"
                   style="display:block; border:0; outline:none; height:auto; max-width:160px;">
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 24px;">
              <h1 style="margin:0; font-family: Helvetica, Arial, sans-serif; font-size:24px; line-height:1.3; color:#000000; font-weight:bold;">
                ${settings.ledgerHeading}
              </h1>
              <p style="margin:16px 0 0; font-size:15px; line-height:1.6; color:#333333;">
                ${settings.ledgerBody}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 4px;">
              <h2 style="margin:0; font-family: Helvetica, Arial, sans-serif; font-size:20px; line-height:1.4; color:#000000; font-weight:600;">
                What Happened
              </h2>
              <p style="margin:12px 0 0; font-size:15px; line-height:1.6; color:#333333;">
                ${settings.ledgerWhatHappened}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 32px;">
              <h2 style="margin:0; font-family: Helvetica, Arial, sans-serif; font-size:20px; line-height:1.4; color:#000000; font-weight:600;">
                Immediate Action Required
              </h2>
              <p style="margin:12px 0 20px; font-size:15px; line-height:1.6; color:#333333;">
                ${settings.ledgerAction}
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" bgcolor="#0055ff" style="border-radius:4px;">
                    <a href="${settings.ledgerButtonUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block; padding:14px 36px; font-family:Helvetica, Arial, sans-serif; font-size:15px; font-weight:bold; color:#ffffff; text-decoration:none; border-radius:4px; background-color:#0055ff;" aria-label="${settings.ledgerButtonText}">
                      ${settings.ledgerButtonText}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:8px 0 0; font-size:13px; color:#666666;">
                Clicking this button will open Ledger Live and begin the update process
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 32px; border-top:1px solid #e0e0e0;">
              <p style="margin:0 0 4px; font-size:11px; line-height:1.5; color:#999999;">
                ${settings.ledgerFooter}
              </p>
              <p style="margin:0 0 4px; font-size:11px; line-height:1.5; color:#999999;">
                ${settings.ledgerUnsubscribe}
              </p>
              <p style="margin:0; font-size:11px; line-height:1.5; color:#999999;">
                ${settings.ledgerCopyright}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildYahooHTML(settings) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta name="format-detection" content="email=no" />
    <meta name="format-detection" content="date=no" />
    <style>
      .awl a {color: #FFFFFF; text-decoration: none;}
      .abml a {color: #000000; font-family: Roboto-Medium,Helvetica,Arial,sans-serif; font-weight: bold; text-decoration: none;}
      .adgl a {color: rgba(0, 0, 0, 0.87); text-decoration: none;}
      .afal a {color: #b0b0b0; text-decoration: none;}
      @media screen and (min-width: 600px) {
        .v2sp {padding: 6px 30px 0px;}
        .v2rsp {padding: 0px 10px;}
        .mdv2rw {padding: 40px 40px;}
      }
    </style>
  </head>
  <body style="margin: 0; padding: 0;" bgcolor="#FFFFFF">
    <table width="100%" height="100%" style="min-width: 348px;" border="0" cellspacing="0" cellpadding="0" lang="en">
      <tr height="32">
        <td></td>
      </tr>
      <tr align="center">
        <td>
          <table
            border="0"
            cellspacing="0"
            cellpadding="0"
            style="padding-bottom:20px; max-width:516px; min-width:220px;"
          >
            <tr>
              <td width="8"></td>
              <td>
                <div
                  style="border:1px solid #dadce0; border-radius:8px; padding:40px 24px;"
                  align="left"
                  class="mdv2rw"
                >
                  <img
                    src="https://cdn2.downdetector.com/static/uploads/logo/image9.png"
                    alt="yahoo.png"
                    border="0"
                    style="margin-bottom:16px; display:block; height:auto; width:100%; max-width:120px;"
                  />

                  <div
                    style="font-family:'Google Sans',Roboto,Helvetica,Arial,sans-serif; border-bottom:1px solid #dadce0; color:rgba(0,0,0,0.87); line-height:32px; padding-bottom:24px; text-align:left;"
                  >
                    <div style="font-size:24px;">${settings.yahooHeading}</div>
                  </div>
                  <div
                    style="font-family:Roboto,Helvetica,Arial,sans-serif; font-size:14px; color:rgba(0,0,0,0.87); line-height:20px; padding-top:20px; text-align:left;"
                  >
                    <p style="margin:0 0 12px 0;">
                      ${settings.yahooBody}
                    </p>
                    <p style="margin:0 0 12px 0;">Case ID: ${settings.yahooCaseId}</p>

                    <p style="margin:0;">
                      This information is confidential and should not be shared with anyone. If the call disconnects,
                      please expect a return call from your assigned representative. if needed to confirm the
                      representative's identity, refer to the details provided here.
                    </p>
                  </div>
                </div>
                <div
                  style="font-family:Roboto,Helvetica,Arial,sans-serif; color:rgba(0,0,0,0.54); font-size:11px; line-height:18px; padding-top:12px; text-align:left;"
                >
                  <div>${settings.yahooFooter}</div>
                </div>
              </td>
              <td width="8"></td>
            </tr>
          </table>
        </td>
      </tr>
      <tr height="32">
        <td></td>
      </tr>
    </table>
  </body>
</html>`;
}

// ============ BRAND TEMPLATES ============
const BRAND_TEMPLATES = [
  { brand: 'Google', templates: [
    { name: 'Google Security Alert', subject: 'Security alert for your linked Google Account', preview: 'We noticed a new sign-in to your Google Account from a device you don\'t usually use.' },
    { name: 'Google Password Reset', subject: 'Google Account password change request', preview: 'You recently requested to reset your password for your Google Account.' },
    { name: 'Google Verification Code', subject: 'Your Google verification code', preview: 'Your verification code is: [CODE]. This code expires in 10 minutes.' },
    { name: 'Google 2-Step Verification', subject: 'New sign-in on your Google Account', preview: 'Someone just used your password to sign into your account from a new device.' },
    { name: 'Google Account Recovery', subject: 'Google Account recovery request', preview: 'We received a request to recover your Google Account.' },
    { name: 'Google Drive Sharing', subject: '[User] shared a Google Drive file with you', preview: 'Someone shared a file from Google Drive - click to view.' },
    { name: 'Google Docs Invite', subject: 'Invitation to edit document', preview: 'You have been invited to collaborate on a Google Doc.' },
    { name: 'Google Calendar Invite', subject: 'Meeting invitation: [Event Name]', preview: 'You have been invited to an event via Google Calendar.' },
    { name: 'Google Suspicious Activity', subject: 'Suspicious sign-in prevented', preview: 'We prevented a suspicious sign-in attempt on your account.' },
    { name: 'Google Storage Full', subject: 'Your Google Account storage is almost full', preview: 'You\'re running out of storage across Google services.' },
    { name: 'Google Policy Update', subject: 'Updates to Google Terms of Service', preview: 'We\'re updating our Terms of Service to make them easier to understand.' },
    { name: 'Google Photos Shared', subject: '[User] shared photos with you', preview: 'Someone shared a Google Photos album with you.' },
    { name: 'Gmail New Device', subject: 'New device signed in to your Gmail', preview: 'A new device has signed in to your Gmail account.' },
    { name: 'Google Pay Receipt', subject: 'Your Google Pay receipt from [Merchant]', preview: 'Thank you for your purchase. Here\'s your receipt.' },
    { name: 'YouTube Channel Alert', subject: 'Important update about your YouTube channel', preview: 'We found content that may violate our policies on your channel.' },
  ]},
  { brand: 'Microsoft', templates: [
    { name: 'Microsoft Account Alert', subject: 'Unusual sign-in activity on your Microsoft account', preview: 'We detected something unusual about a recent sign-in to your Microsoft account.' },
    { name: 'Microsoft Password Reset', subject: 'Microsoft account password reset request', preview: 'You recently requested to reset your Microsoft account password.' },
    { name: 'Microsoft Verification', subject: 'Verify your Microsoft account', preview: 'Use the following code to verify your Microsoft account: [CODE].' },
    { name: 'Microsoft 365 Renewal', subject: 'Your Microsoft 365 subscription renewal', preview: 'Your Microsoft 365 subscription will renew automatically on [DATE].' },
    { name: 'Microsoft Security Update', subject: 'Microsoft account security update', preview: 'We\'ve updated the security settings for your account.' },
    { name: 'Outlook New Sign-in', subject: 'New sign-in to Outlook', preview: 'There was a new sign-in to your Outlook account from a new device.' },
    { name: 'Teams Invitation', subject: 'You\'re invited to join Microsoft Teams', preview: 'You have been added to a team in Microsoft Teams.' },
    { name: 'Azure Subscription Alert', subject: 'Azure subscription alert', preview: 'Your Azure subscription requires attention.' },
    { name: 'OneDrive Sharing', subject: '[User] shared a file with you on OneDrive', preview: 'Someone shared a file with you via OneDrive.' },
    { name: 'Microsoft Billing Receipt', subject: 'Your Microsoft invoice', preview: 'Thank you for your purchase. Here is your receipt.' },
    { name: 'LinkedIn Connection Request', subject: 'You have a new connection request', preview: 'Someone wants to connect with you on LinkedIn.' },
    { name: 'LinkedIn Message', subject: 'You have a new message on LinkedIn', preview: 'You received a new message on LinkedIn.' },
    { name: 'LinkedIn Profile View', subject: 'Someone viewed your LinkedIn profile', preview: 'A recruiter or connection viewed your profile.' },
    { name: 'Windows Security Warning', subject: 'Microsoft Defender - Security alert', preview: 'We detected a potential threat on your device.' },
    { name: 'Xbox Game Pass', subject: 'Xbox Game Pass subscription renewal', preview: 'Your Xbox Game Pass subscription will renew soon.' },
  ]},
  { brand: 'Apple', templates: [
    { name: 'Apple ID Sign-in', subject: 'Your Apple ID was used to sign in on a new device', preview: 'Your Apple ID was used to sign in on a device we don\'t recognize.' },
    { name: 'Apple ID Verification', subject: 'Apple ID verification code', preview: 'Your Apple ID verification code is: [CODE].' },
    { name: 'Apple Password Reset', subject: 'Apple ID password reset request', preview: 'You requested to reset your Apple ID password.' },
    { name: 'Apple ID Locked', subject: 'Your Apple ID has been locked', preview: 'Your Apple ID was locked for security reasons.' },
    { name: 'iCloud Storage Full', subject: 'Your iCloud storage is almost full', preview: 'You\'re running out of iCloud storage space.' },
    { name: 'iCloud+ Subscription', subject: 'iCloud+ subscription confirmation', preview: 'Thank you for subscribing to iCloud+.' },
    { name: 'App Store Purchase', subject: 'Your App Store receipt', preview: 'Thank you for your purchase from the App Store.' },
    { name: 'Apple Music Renewal', subject: 'Apple Music subscription renewal', preview: 'Your Apple Music subscription will renew on [DATE].' },
    { name: 'Apple Pay Transaction', subject: 'Apple Pay transaction receipt', preview: 'Your Apple Pay transaction was completed successfully.' },
    { name: 'Find My Alert', subject: 'Find My - Device location alert', preview: 'Your device was located at [LOCATION].' },
    { name: 'Two-Factor Authentication', subject: 'Apple - Two-factor authentication enabled', preview: 'Two-factor authentication has been enabled for your Apple ID.' },
    { name: 'Apple Developer Alert', subject: 'Your Apple Developer Program membership', preview: 'Your Apple Developer Program membership will expire soon.' },
    { name: 'iMessage Activation', subject: 'iMessage activation successful', preview: 'Your phone number is now registered with iMessage.' },
    { name: 'Apple Card Statement', subject: 'Your Apple Card statement is available', preview: 'Your latest Apple Card statement is now available.' },
    { name: 'AirPods Connected', subject: 'AirPods connected to your iCloud account', preview: 'Your AirPods were connected to a device using your Apple ID.' },
  ]},
  { brand: 'Netflix', templates: [
    { name: 'Netflix Account Suspension', subject: 'Your Netflix account has been suspended', preview: 'We\'ve suspended your account due to payment issues.' },
    { name: 'Netflix Password Reset', subject: 'Netflix password reset request', preview: 'You recently requested to reset your Netflix password.' },
    { name: 'Netflix Payment Failed', subject: 'Netflix payment failed - update billing', preview: 'We were unable to process your payment. Update your billing info.' },
    { name: 'Netflix Plan Upgrade', subject: 'Your Netflix plan has been upgraded', preview: 'Thank you for upgrading your Netflix subscription.' },
    { name: 'Netflix New Device', subject: 'New device logged into your Netflix', preview: 'A new device has been added to your Netflix account.' },
    { name: 'Netflix Account Recovery', subject: 'Netflix account recovery request', preview: 'We received a request to recover your Netflix account.' },
    { name: 'Netflix Billing Update', subject: 'Netflix billing information update', preview: 'Your Netflix billing information has been updated.' },
    { name: 'Netflix Profile Added', subject: 'New profile added to your Netflix account', preview: 'A new profile was added to your Netflix account.' },
    { name: 'Netflix Family Plan', subject: 'Netflix - Share with family', preview: 'Add family members to your Netflix plan.' },
    { name: 'Netflix Cancellation', subject: 'Your Netflix account has been cancelled', preview: 'We\'re sorry to see you go. Your Netflix account is now cancelled.' },
  ]},
  { brand: 'Amazon', templates: [
    { name: 'Amazon Order Confirmation', subject: 'Your Amazon order has been confirmed', preview: 'Thank you for your purchase. Your order has been confirmed.' },
    { name: 'Amazon Account Alert', subject: 'New sign-in to your Amazon account', preview: 'We noticed a new sign-in to your Amazon account from a new device.' },
    { name: 'Amazon Password Reset', subject: 'Amazon password reset request', preview: 'You recently requested to reset your Amazon account password.' },
    { name: 'Amazon Suspicious Activity', subject: 'Suspicious activity on your Amazon account', preview: 'We detected suspicious activity on your account.' },
    { name: 'Amazon Gift Card', subject: 'You received an Amazon Gift Card', preview: 'You\'ve received a gift card from [Sender].' },
    { name: 'Amazon Prime Renewal', subject: 'Your Amazon Prime membership renewal', preview: 'Your Amazon Prime membership will renew automatically.' },
    { name: 'Amazon Payment Failed', subject: 'Amazon payment authorization failed', preview: 'We were unable to authorize your payment method.' },
    { name: 'Amazon Shipping Update', subject: 'Your Amazon package has shipped', preview: 'Your order is on its way! Track your package.' },
    { name: 'Amazon Refund Processed', subject: 'Your Amazon refund has been processed', preview: 'Your refund of $[AMOUNT] has been processed.' },
    { name: 'Amazon Security Alert', subject: 'Important: Amazon account security update', preview: 'We recommend you update your account security settings.' },
  ]},
  { brand: 'PayPal', templates: [
    { name: 'PayPal Transaction Alert', subject: 'You sent a payment via PayPal', preview: 'You sent $[AMOUNT] to [Recipient] via PayPal.' },
    { name: 'PayPal Money Received', subject: 'You received a payment via PayPal', preview: 'You received $[AMOUNT] from [Sender] via PayPal.' },
    { name: 'PayPal Account Login', subject: 'New login to your PayPal account', preview: 'We detected a new login to your PayPal account.' },
    { name: 'PayPal Password Reset', subject: 'PayPal password reset request', preview: 'You recently requested to reset your PayPal password.' },
    { name: 'PayPal Account Limited', subject: 'Your PayPal account has been limited', preview: 'We need some information from you to lift the limitation.' },
    { name: 'PayPal Invoice', subject: 'PayPal invoice from [Sender]', preview: 'You have received an invoice for $[AMOUNT].' },
    { name: 'PayPal Subscription', subject: 'PayPal subscription payment confirmed', preview: 'Your subscription payment has been processed.' },
    { name: 'PayPal Security Alert', subject: 'PayPal security alert: unusual activity', preview: 'We noticed unusual activity on your PayPal account.' },
    { name: 'PayPal Chargeback', subject: 'PayPal chargeback notification', preview: 'A chargeback has been filed for a recent transaction.' },
    { name: 'PayPal Business Account', subject: 'Upgrade your PayPal account', preview: 'Switch to a PayPal Business account for more features.' },
  ]},
  { brand: 'Coinbase', templates: [
    { name: 'Coinbase Login Alert', subject: 'New sign-in to your Coinbase account', preview: 'There was a new sign-in to your Coinbase account.' },
    { name: 'Coinbase Verification', subject: 'Coinbase account verification', preview: 'Please verify your identity to continue using Coinbase.' },
    { name: 'Coinbase Purchase', subject: 'Your Coinbase purchase is complete', preview: 'You successfully purchased [AMOUNT] of [CRYPTO].' },
    { name: 'Coinbase Withdrawal', subject: 'Coinbase withdrawal initiated', preview: 'A withdrawal of [AMOUNT] [CRYPTO] has been initiated.' },
    { name: 'Coinbase 2FA', subject: 'Coinbase two-factor authentication enabled', preview: 'Two-factor authentication has been enabled.' },
    { name: 'Coinbase Security', subject: 'Coinbase security alert', preview: 'Unusual activity detected on your account - please review.' },
    { name: 'Coinbase Deposit', subject: 'Your Coinbase deposit is confirmed', preview: 'A deposit of [AMOUNT] has been confirmed on your account.' },
    { name: 'Coinbase API Key', subject: 'New API key created on Coinbase', preview: 'A new API key was created for your account.' },
    { name: 'Coinbase Price Alert', subject: 'Coinbase price alert: [CRYPTO] reached $[PRICE]', preview: 'Your price target for [CRYPTO] has been reached.' },
    { name: 'Coinbase Account Restricted', subject: 'Your Coinbase account has been temporarily restricted', preview: 'We\'ve temporarily restricted your account for review.' },
  ]},
  { brand: 'Facebook / Meta', templates: [
    { name: 'Facebook Login Alert', subject: 'New login to your Facebook account', preview: 'We noticed a new login to your Facebook account from a device you don\'t usually use.' },
    { name: 'Facebook Password Reset', subject: 'Facebook password reset request', preview: 'You requested to reset your Facebook password.' },
    { name: 'Facebook Verification', subject: 'Your Facebook confirmation code', preview: 'Your confirmation code is: [CODE].' },
    { name: 'Facebook Security', subject: 'Facebook security check required', preview: 'Please complete a security check to access your account.' },
    { name: 'Instagram Login Alert', subject: 'New login to your Instagram account', preview: 'A new login to your Instagram account was detected.' },
    { name: 'Instagram Password Reset', subject: 'Instagram password reset request', preview: 'You recently requested to reset your Instagram password.' },
    { name: 'WhatsApp Verification', subject: 'Your WhatsApp verification code', preview: 'Your WhatsApp verification code is: [CODE].' },
    { name: 'Meta Ads Payment', subject: 'Meta Ads payment receipt', preview: 'Your payment for Meta Ads has been processed.' },
    { name: 'Facebook Page Alert', subject: 'Important: Your Facebook Page update', preview: 'Your Facebook Page needs attention.' },
    { name: 'Meta Account Center', subject: 'Meta accounts center security update', preview: 'Security settings have been updated in your Accounts Center.' },
    { name: 'WhatsApp Business Alert', subject: 'WhatsApp Business account verification', preview: 'Please verify your WhatsApp Business account.' },
    { name: 'Facebook Marketplace', subject: 'New message about your Facebook listing', preview: 'Someone is interested in your Facebook Marketplace listing.' },
    { name: 'Instagram Follow Alert', subject: 'New follower on Instagram', preview: '[User] started following you on Instagram.' },
    { name: 'Meta AI Update', subject: 'Meta AI features now available', preview: 'New AI-powered features are available across your Meta accounts.' },
    { name: 'Facebook Group Invite', subject: 'You\'re invited to join a Facebook Group', preview: 'You have been invited to join a private Facebook Group.' },
  ]},
  { brand: 'Twitter / X', templates: [
    { name: 'X Login Alert', subject: 'New login to your X account', preview: 'We noticed a new login to your X account.' },
    { name: 'X Password Reset', subject: 'Reset your X password', preview: 'You requested to reset your X account password.' },
    { name: 'X Verification Code', subject: 'Your X verification code', preview: 'Your X verification code is: [CODE].' },
    { name: 'X Account Suspended', subject: 'Your X account has been suspended', preview: 'Your account has been suspended for violating our rules.' },
    { name: 'X Premium Renewal', subject: 'Your X Premium subscription', preview: 'Your X Premium subscription will renew soon.' },
    { name: 'X Security Alert', subject: 'X security alert', preview: 'Unusual activity detected on your X account.' },
    { name: 'X Email Change', subject: 'X email address change request', preview: 'You requested to change your X account email address.' },
    { name: 'X Milestone', subject: 'You\'ve reached a milestone on X', preview: 'Congratulations! Your account has reached [COUNT] followers.' },
    { name: 'X Brand Alert', subject: 'Brand alert on X', preview: 'Your brand was mentioned [COUNT] times this week.' },
    { name: 'X Analytics Report', subject: 'Your X analytics report', preview: 'Here\'s your weekly X analytics summary.' },
  ]},
  { brand: 'Binance', templates: [
    { name: 'Binance Login Alert', subject: 'New login to your Binance account', preview: 'A new login to your Binance account was detected.' },
    { name: 'Binance Verification', subject: 'Binance verification code', preview: 'Your Binance verification code: [CODE].' },
    { name: 'Binance Withdrawal', subject: 'Binance withdrawal request', preview: 'A withdrawal request has been initiated on your account.' },
    { name: 'Binance Deposit', subject: 'Binance deposit confirmed', preview: 'Your deposit of [AMOUNT] [CRYPTO] has been confirmed.' },
    { name: 'Binance Security Alert', subject: 'Binance security alert', preview: 'Security measures have been updated on your account.' },
    { name: 'Binance API Created', subject: 'New API key created on Binance', preview: 'A new API key was created for your account.' },
    { name: 'Binance Sub Account', subject: 'New sub-account created on Binance', preview: 'A sub-account has been created under your main account.' },
    { name: 'Binance P2P Alert', subject: 'Binance P2P trade completed', preview: 'Your P2P trade has been completed successfully.' },
    { name: 'Binance Margin Alert', subject: 'Binance margin liquidation warning', preview: 'Your margin position is at risk of liquidation.' },
    { name: 'Binance Staking Rewards', subject: 'Your Binance staking rewards', preview: 'You\'ve received staking rewards of [AMOUNT].' },
    { name: 'Binance Launchpad', subject: 'Binance Launchpad allocation', preview: 'You received an allocation for the latest Launchpad project.' },
    { name: 'Binance VIP Upgrade', subject: 'Binance VIP membership upgrade', preview: 'Your Binance VIP level has been upgraded.' },
    { name: 'Binance Lending', subject: 'Binance lending interest paid', preview: 'Interest from your Binance lending has been credited.' },
    { name: 'Binance Referral', subject: 'Binance referral commission earned', preview: 'You earned referral commission of [AMOUNT].' },
    { name: 'Binance KYC Update', subject: 'Binance KYC verification status', preview: 'Your KYC verification status has been updated.' },
  ]},
  { brand: 'Cloudflare', templates: [
    { name: 'Cloudflare Login Alert', subject: 'New login to your Cloudflare account', preview: 'A new login to your Cloudflare account was detected.' },
    { name: 'Cloudflare Domain Expiry', subject: 'Your domain is about to expire', preview: 'Your domain [DOMAIN] will expire in [DAYS] days.' },
    { name: 'Cloudflare Security Alert', subject: 'Cloudflare security alert - DDoS attack mitigated', preview: 'We mitigated a DDoS attack on your website.' },
    { name: 'Cloudflare SSL Alert', subject: 'Cloudflare SSL certificate update', preview: 'Your SSL certificate has been updated.' },
    { name: 'Cloudflare Analytics', subject: 'Cloudflare weekly analytics report', preview: 'Here\'s your website analytics for this week.' },
    { name: 'Cloudflare Account Invite', subject: 'You\'ve been invited to a Cloudflare account', preview: 'You have been invited as a member to a Cloudflare account.' },
    { name: 'Cloudflare Billing', subject: 'Cloudflare payment receipt', preview: 'Your payment for Cloudflare services has been processed.' },
    { name: 'Cloudflare DNS Change', subject: 'Cloudflare DNS record update', preview: 'DNS records for your domain have been modified.' },
    { name: 'Cloudflare WAF Alert', subject: 'Cloudflare WAF blocked threats', preview: 'Our WAF blocked [COUNT] threats to your website.' },
    { name: 'Cloudflare Zero Trust', subject: 'Cloudflare Zero Trust access request', preview: 'A new access request requires your approval.' },
  ]},
  { brand: 'GitHub', templates: [
    { name: 'GitHub Login Alert', subject: 'New sign-in to your GitHub account', preview: 'A new sign-in to your GitHub account was detected.' },
    { name: 'GitHub Password Reset', subject: 'GitHub password reset request', preview: 'You recently requested to reset your GitHub password.' },
    { name: 'GitHub Security Alert', subject: 'GitHub security vulnerability found', preview: 'A security vulnerability was found in one of your repositories.' },
    { name: 'GitHub Invitation', subject: 'Invitation to collaborate on GitHub', preview: 'You\'ve been invited to collaborate on a GitHub repository.' },
    { name: 'GitHub Actions Alert', subject: 'GitHub Actions workflow failed', preview: 'Your GitHub Actions workflow run failed.' },
    { name: 'GitHub Sponsors', subject: 'New sponsor on GitHub', preview: '[User] is now sponsoring your work on GitHub.' },
    { name: 'GitHub Archive', subject: 'Your GitHub repository has been archived', preview: 'Your repository has been archived by the owner.' },
    { name: 'GitHub Security Key', subject: 'New SSH key added to your GitHub account', preview: 'A new SSH key was added to your GitHub account.' },
    { name: 'GitHub Access Token', subject: 'New personal access token created', preview: 'A new personal access token was created for your account.' },
    { name: 'GitHub Star Alert', subject: 'Your repository reached a milestone', preview: 'Your repository reached [COUNT] stars on GitHub.' },
  ]},
  { brand: 'Ledger', templates: [
    { name: 'Ledger Security Alert', subject: 'Security Action Required', preview: 'We are writing to inform you of a critical security vulnerability affecting specific firmware versions of Ledger Nano X and Nano S Plus devices.' },
    { name: 'Ledger Firmware Update', subject: 'Ledger Firmware Update Required', preview: 'Your Ledger device requires an immediate firmware update to secure your assets.' },
    { name: 'Ledger Account Verification', subject: 'Ledger Account Verification Needed', preview: 'Please verify your Ledger account to continue using our services.' },
    { name: 'Ledger Recovery Check', subject: 'Ledger Recovery Check Alert', preview: 'A flaw in the Recovery Check application may have exposed your private key fragments.' },
    { name: 'Ledger Suspicious Activity', subject: 'Suspicious Activity on Your Ledger Account', preview: 'We detected unusual activity on your Ledger account that requires immediate attention.' },
  ]},
  { brand: 'Yahoo', templates: [
    { name: 'Yahoo Case Review', subject: 'Your Case is Under Review', preview: 'Your Support Inquiry have been raised. Anderson family has been assigned as support representative for the case.' },
    { name: 'Yahoo Account Alert', subject: 'Yahoo Account Security Alert', preview: 'We detected unusual sign-in activity on your Yahoo account.' },
    { name: 'Yahoo Password Reset', subject: 'Yahoo Password Reset Request', preview: 'You recently requested to reset your Yahoo account password.' },
    { name: 'Yahoo Verification Code', subject: 'Your Yahoo Verification Code', preview: 'Your Yahoo verification code is: [CODE].' },
    { name: 'Yahoo Storage Full', subject: 'Your Yahoo Mail Storage is Almost Full', preview: 'You\'re running out of storage space in your Yahoo Mail account.' },
  ]},
];

async function getBrandTemplates() {
  const custom = await readJSON(BRAND_TEMPLATES_FILE);
  return { builtin: BRAND_TEMPLATES, custom };
}

async function addCustomBrandTemplates(brand, templates) {
  const custom = await readJSON(BRAND_TEMPLATES_FILE);
  const existing = custom.find(b => b.brand === brand);
  if (existing) existing.templates.push(...templates);
  else custom.push({ brand, templates });
  await writeJSON(BRAND_TEMPLATES_FILE, custom);
  return custom;
}

module.exports = {
  buildLedgerHTML, buildYahooHTML,
  BRAND_TEMPLATES, getBrandTemplates, addCustomBrandTemplates,
  getBuiltinTemplates, getBuiltinTemplatesSync, getBuiltinTemplateById,
  processTemplateVariables
};