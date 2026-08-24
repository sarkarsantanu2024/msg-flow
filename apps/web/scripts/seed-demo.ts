/**
 * Builds the demo workspace used to show MsgFlow to a client.
 *
 * Everything it creates is marked `ingestSource: DEMO` (and the connection
 * `provider: DEMO`), so the dashboard's "Demo data" switch can hide all of it
 * without touching a single real message.
 *
 * The records are NOT fabricated. The script inserts messages and then calls
 * the real `runAutomation` pipeline over them, so what you show a client is
 * genuine output from the same code path that processes live WhatsApp traffic.
 *
 * Run from apps/web (so ./storage matches the dev server):
 *   pnpm demo:seed          — build it
 *   pnpm demo:seed --reset  — tear it down and rebuild
 */

import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@msgflow/db';
import { runAutomation } from '@msgflow/workflow';

const TENANT_SLUG = 'sunrise-demo';
const DEMO_USERNAME = 'sunrise';
const DEMO_PASSWORD = 'sunrise-demo-2026';

const DAY = 86_400_000;

interface SeedMessage {
  group: 'sales' | 'orders' | 'payments';
  sender: string;
  /**
   * Message text *without* the leading date — that is prefixed at insert time
   * from `daysAgo`, so the demo data stays current no matter when it is built.
   */
  body: string;
  /** Days before today. */
  daysAgo: number;
  hour: number;
  /** Chatter: inserted verbatim, with no date prefix, to exercise the filter. */
  chatter?: boolean;
}

/**
 * Realistic Indian SMB WhatsApp traffic.
 *
 * Deliberately mixed: most messages carry a full set of business facts, a few
 * are missing the product so they land in the review queue, and a handful are
 * pure chatter so the "skip small talk" filter visibly does something.
 */
const MESSAGES: SeedMessage[] = [
  // ---- Sales enquiries -------------------------------------------------
  { group: 'sales', sender: 'Anil Kumar', daysAgo: 6, hour: 9, chatter: true, body: 'Good morning all 🙏' },
  { group: 'sales', sender: 'Anil Kumar', daysAgo: 6, hour: 10, body: 'Enquiry from Sharma Traders. item: Cement, qty 250 bags @ 385. Contact 9830012345' },
  { group: 'sales', sender: 'Priya Nair', daysAgo: 6, hour: 11, body: 'Requirement from Bengal Hardware. item: TMT-Bars, qty 8 ton @ 52000. Quote needed.' },
  { group: 'sales', sender: 'Anil Kumar', daysAgo: 6, hour: 15, body: 'Quotation for Kolkata Builders. item: Sand, qty 40 units @ 1200' },
  { group: 'sales', sender: 'Rakesh Singh', daysAgo: 5, hour: 10, body: 'Enquiry from Das Enterprises. item: Paint, qty 120 ltr @ 410. Mobile 9903456712' },
  { group: 'sales', sender: 'Priya Nair', daysAgo: 5, hour: 12, body: 'Requirement from Mondal Cement Agency. item: Cement, qty 500 bags @ 380' },
  { group: 'sales', sender: 'Anil Kumar', daysAgo: 5, hour: 16, chatter: true, body: 'ok noted' },
  { group: 'sales', sender: 'Rakesh Singh', daysAgo: 4, hour: 9, body: 'Urgent enquiry from Howrah Steel Works. item: TMT-Bars, qty 12 ton @ 51500' },
  { group: 'sales', sender: 'Priya Nair', daysAgo: 4, hour: 11, body: 'Requirement from Ganguly Constructions. item: Cement, qty 300 bags @ 390' },
  { group: 'sales', sender: 'Anil Kumar', daysAgo: 4, hour: 14, body: 'Customer needs rate for cement, will confirm party name later' },
  { group: 'sales', sender: 'Rakesh Singh', daysAgo: 3, hour: 10, body: 'Enquiry from Salt Lake Infra. item: Bricks, qty 5000 pcs @ 9. Contact 9831122334' },
  { group: 'sales', sender: 'Priya Nair', daysAgo: 3, hour: 13, body: 'Requirement from Behala Traders. item: Sand, qty 60 units @ 1150' },
  { group: 'sales', sender: 'Anil Kumar', daysAgo: 2, hour: 10, body: 'Repeat enquiry from Sharma Traders. item: Bricks, qty 8000 pcs @ 9' },
  { group: 'sales', sender: 'Rakesh Singh', daysAgo: 2, hour: 15, body: 'Requirement from Dutta Hardware. item: Paint, qty 200 ltr @ 405. Mobile 9874561230' },
  { group: 'sales', sender: 'Priya Nair', daysAgo: 1, hour: 9, body: 'Enquiry from Barrackpore Builders. item: Cement, qty 150 bags @ 388' },
  { group: 'sales', sender: 'Anil Kumar', daysAgo: 1, hour: 12, body: 'Quote required from Bengal Hardware. item: Sand, qty 25 units @ 1250' },
  { group: 'sales', sender: 'Rakesh Singh', daysAgo: 0, hour: 10, body: 'New requirement from Newtown Projects. item: TMT-Bars, qty 15 ton @ 51000. Contact 9800112233' },
  { group: 'sales', sender: 'Priya Nair', daysAgo: 0, hour: 11, chatter: true, body: 'thanks 👍' },

  // ---- Orders & dispatch -----------------------------------------------
  { group: 'orders', sender: 'Sunita Roy', daysAgo: 6, hour: 12, body: 'Order ORD-10234 from Sharma Traders. item: Cement, qty 250 bags @ 385. Dispatch scheduled.' },
  { group: 'orders', sender: 'Sunita Roy', daysAgo: 5, hour: 11, body: 'Order PO-88121 from Bengal Hardware. item: TMT-Bars, qty 8 ton @ 52000' },
  { group: 'orders', sender: 'Vikram Bose', daysAgo: 5, hour: 17, body: 'Dispatched ORD-10234 for Sharma Traders. item: Cement, qty 250 bags @ 385. Truck WB23A4471.' },
  { group: 'orders', sender: 'Sunita Roy', daysAgo: 4, hour: 10, body: 'Order ORD-10241 from Das Enterprises. item: Paint, qty 120 ltr @ 410' },
  { group: 'orders', sender: 'Vikram Bose', daysAgo: 4, hour: 16, body: 'Delivery completed for Bengal Hardware against PO-88121. item: TMT-Bars, qty 8 ton @ 52000' },
  { group: 'orders', sender: 'Sunita Roy', daysAgo: 3, hour: 11, body: 'Order ORD-10256 from Mondal Cement Agency. item: Cement, qty 500 bags @ 380' },
  { group: 'orders', sender: 'Vikram Bose', daysAgo: 3, hour: 15, chatter: true, body: 'Truck arranged for tomorrow' },
  { group: 'orders', sender: 'Sunita Roy', daysAgo: 2, hour: 10, body: 'Order ORD-10262 from Howrah Steel Works. item: TMT-Bars, qty 12 ton @ 51500' },
  { group: 'orders', sender: 'Vikram Bose', daysAgo: 2, hour: 14, body: 'Dispatched ORD-10256 for Mondal Cement Agency. item: Cement, qty 500 bags @ 380' },
  { group: 'orders', sender: 'Sunita Roy', daysAgo: 1, hour: 11, body: 'Order ORD-10271 from Salt Lake Infra. item: Bricks, qty 5000 pcs @ 9' },
  { group: 'orders', sender: 'Vikram Bose', daysAgo: 1, hour: 16, body: 'Dispatched ORD-10262 for Howrah Steel Works. item: TMT-Bars, qty 12 ton @ 51500' },
  { group: 'orders', sender: 'Sunita Roy', daysAgo: 0, hour: 12, body: 'Order ORD-10288 from Ganguly Constructions. item: Cement, qty 300 bags @ 390' },

  // ---- Payments ---------------------------------------------------------
  { group: 'payments', sender: 'Meera Ghosh', daysAgo: 5, hour: 13, body: 'Payment received from Sharma Traders against INV-4451 ₹96250. item: Cement' },
  { group: 'payments', sender: 'Meera Ghosh', daysAgo: 4, hour: 12, body: 'NEFT received from Bengal Hardware against INV-4460 ₹416000. item: TMT-Bars' },
  { group: 'payments', sender: 'Meera Ghosh', daysAgo: 3, hour: 14, body: 'UPI payment from Das Enterprises against INV-4468 ₹49200. item: Paint' },
  { group: 'payments', sender: 'Meera Ghosh', daysAgo: 3, hour: 16, chatter: true, body: 'Outstanding follow up needed' },
  { group: 'payments', sender: 'Meera Ghosh', daysAgo: 2, hour: 11, body: 'Payment received from Mondal Cement Agency against INV-4472 ₹190000. item: Cement' },
  { group: 'payments', sender: 'Meera Ghosh', daysAgo: 1, hour: 15, body: 'RTGS from Howrah Steel Works against INV-4480 ₹618000. item: TMT-Bars' },
  { group: 'payments', sender: 'Meera Ghosh', daysAgo: 0, hour: 13, body: 'Payment received from Salt Lake Infra against INV-4491 ₹45000. item: Bricks' },
];

const GROUP_DEFS = {
  sales: { name: 'Sunrise — Sales Enquiries', participants: 14 },
  orders: { name: 'Sunrise — Orders & Dispatch', participants: 9 },
  payments: { name: 'Sunrise — Accounts & Payments', participants: 5 },
} as const;

const SCHEMA_FIELDS = [
  { key: 'date', label: 'Date', type: 'DATE', required: true, isKeyField: true, description: 'Date of the enquiry or order' },
  { key: 'customerName', label: 'Customer', type: 'STRING', required: true, isKeyField: true, description: 'Customer or party name' },
  { key: 'product', label: 'Product', type: 'STRING', required: true, isKeyField: true, description: 'Product or material' },
  { key: 'quantity', label: 'Quantity', type: 'DECIMAL', required: false, isKeyField: false, description: 'Quantity requested' },
  { key: 'unit', label: 'Unit', type: 'STRING', required: false, isKeyField: false, description: 'Unit of measure' },
  { key: 'rate', label: 'Rate', type: 'CURRENCY', required: false, isKeyField: false, description: 'Rate per unit' },
  { key: 'amount', label: 'Amount', type: 'CURRENCY', required: false, isKeyField: false, description: 'Total value' },
  { key: 'orderNo', label: 'Order / Invoice No', type: 'STRING', required: false, isKeyField: false, description: 'Order or invoice reference' },
  { key: 'phone', label: 'Phone', type: 'PHONE', required: false, isKeyField: false, description: 'Contact number' },
  { key: 'salesPerson', label: 'Reported By', type: 'STRING', required: false, isKeyField: false, description: 'Who sent the message' },
  { key: 'notes', label: 'Notes', type: 'TEXT', required: false, isKeyField: false, description: 'Original message text' },
] as const;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function reset(): Promise<void> {
  const existing = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (existing) {
    // Tenant cascades to connections, groups, messages, records, outputs, runs.
    await prisma.tenant.delete({ where: { id: existing.id } });
    console.log('  removed the previous demo workspace');
  }
  await prisma.user.deleteMany({ where: { username: DEMO_USERNAME } });
}

async function main(): Promise<void> {
  const wantsReset = process.argv.includes('--reset');

  console.log('\nMsgFlow — building the demo workspace\n');

  if (wantsReset) {
    console.log('Resetting…');
    await reset();
  } else if (await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } })) {
    console.log('The demo workspace already exists. Re-run with --reset to rebuild it.\n');
    return;
  }

  // --- Workspace and its owner -------------------------------------------
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Sunrise Trading Co.',
      slug: TENANT_SLUG,
      status: 'ACTIVE',
      timezone: 'Asia/Kolkata',
      // Demo data starts visible; the dashboard switch writes this back.
      settings: { demoMode: true },
    },
  });

  const user = await prisma.user.create({
    data: {
      username: DEMO_USERNAME,
      name: 'Ravi Menon',
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
      memberships: { create: { tenantId: tenant.id, role: 'OWNER' } },
    },
  });

  const plan = await prisma.plan.findFirst({ where: { slug: 'starter' } });
  if (plan) {
    await prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        status: 'ACTIVE',
        currentPeriodEnd: new Date(Date.now() + 300 * DAY),
      },
    });
  }
  console.log(`  workspace "${tenant.name}" and owner "${DEMO_USERNAME}"`);

  // --- Connection and groups ---------------------------------------------
  const connection = await prisma.whatsAppConnection.create({
    data: {
      tenantId: tenant.id,
      name: 'Sunrise WhatsApp',
      provider: 'DEMO',
      status: 'READY',
      phoneNumber: '+919812345678',
      displayName: 'Sunrise Trading Co.',
      connectedAt: new Date(Date.now() - 30 * DAY),
      lastHeartbeatAt: new Date(),
      lastMessageAt: new Date(),
    },
  });

  const groupIds: Record<string, string> = {};
  for (const [key, def] of Object.entries(GROUP_DEFS)) {
    const group = await prisma.whatsAppGroup.create({
      data: {
        tenantId: tenant.id,
        connectionId: connection.id,
        externalId: `demo-${key}@g.us`,
        name: def.name,
        isGroup: true,
        isMonitored: true,
        monitoredAt: new Date(Date.now() - 30 * DAY),
        participantCount: def.participants,
      },
    });
    groupIds[key] = group.id;
  }
  console.log(`  ${Object.keys(groupIds).length} monitored groups`);

  // --- Messages ------------------------------------------------------------
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  let index = 0;
  for (const message of MESSAGES) {
    const timestamp = new Date(midnight.getTime() - message.daysAgo * DAY + message.hour * 3_600_000);
    const externalId = `demo-msg-${index}`;

    // Business messages carry an explicit dd/mm, the way people actually write
    // them in a group. It is also what the extractor reads the date from.
    const stamp = `${String(timestamp.getDate()).padStart(2, '0')}/${String(timestamp.getMonth() + 1).padStart(2, '0')}`;
    const text = message.chatter ? message.body : `${stamp} — ${message.body}`;

    await prisma.message.create({
      data: {
        tenantId: tenant.id,
        connectionId: connection.id,
        groupId: groupIds[message.group],
        externalId,
        contentHash: hash(`${tenant.id}:${externalId}:${text}`),
        senderName: message.sender,
        senderId: `demo-${message.sender.toLowerCase().replace(/\s+/g, '-')}`,
        text,
        messageType: 'TEXT',
        timestamp,
        receivedAt: timestamp,
        // The marker the dashboard switch keys off.
        ingestSource: 'DEMO',
        status: 'PENDING',
      },
    });
    index++;
  }

  for (const [key, id] of Object.entries(groupIds)) {
    const count = MESSAGES.filter((m) => m.group === key).length;
    await prisma.whatsAppGroup.update({
      where: { id },
      data: { messageCount: count, lastMessageAt: new Date() },
    });
  }
  console.log(`  ${MESSAGES.length} messages across 7 days`);

  // --- Extraction schema ---------------------------------------------------
  const schema = await prisma.extractionSchema.create({
    data: {
      tenantId: tenant.id,
      name: 'Sales & Order Register',
      slug: 'sales-order-register',
      description: 'Every enquiry, order and payment as one row.',
      confidenceThreshold: 0.7,
      fields: {
        create: SCHEMA_FIELDS.map((field, order) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          isKeyField: field.isKeyField,
          description: field.description,
          order,
        })),
      },
    },
    include: { fields: true },
  });
  console.log(`  schema "${schema.name}" with ${schema.fields.length} columns`);

  // --- Excel output --------------------------------------------------------
  const output = await prisma.output.create({
    data: {
      tenantId: tenant.id,
      name: 'Sales Register 2026.xlsx',
      type: 'EXCEL',
      status: 'ACTIVE',
      config: {
        fileName: 'Sales Register 2026.xlsx',
        worksheet: 'Sales Register',
        headerRow: 1,
      },
      createdBy: user.id,
    },
  });

  // --- Automation ----------------------------------------------------------
  const automation = await prisma.automation.create({
    data: {
      tenantId: tenant.id,
      name: 'Daily Sales Register',
      description: 'Reads the three business groups and keeps the Excel register up to date.',
      status: 'ACTIVE',
      schemaId: schema.id,
      processingMode: 'DAILY',
      dateRangeMode: 'LAST_7_DAYS',
      scheduleHour: 20,
      scheduleMinute: 0,
      timezone: tenant.timezone,
      requireImportant: true,
      minConfidence: 0.7,
      createdBy: user.id,
      triggers: {
        create: Object.values(groupIds).map((groupId) => ({
          tenantId: tenant.id,
          type: 'SCHEDULE' as const,
          groupId,
          enabled: true,
        })),
      },
    },
  });

  const target = await prisma.outputTarget.create({
    data: {
      tenantId: tenant.id,
      automationId: automation.id,
      outputId: output.id,
      operation: 'UPSERT',
      enabled: true,
      order: 0,
      mappings: {
        create: SCHEMA_FIELDS.map((field, order) => ({
          tenantId: tenant.id,
          sourceField: field.key,
          targetField: field.label,
          targetColumn: field.label,
          updateStrategy: 'ALWAYS_UPDATE' as const,
          isKeyPart: field.isKeyField,
          keyOrder: field.isKeyField ? order : null,
          order,
        })),
      },
    },
  });
  console.log(`  automation "${automation.name}" → "${output.name}" (${target.operation})`);

  // --- Run the real pipeline ----------------------------------------------
  console.log('\nRunning the automation over the demo messages…');
  const result = await runAutomation({
    tenantId: tenant.id,
    automationId: automation.id,
    trigger: 'MANUAL',
    startedBy: user.id,
    force: true,
  });

  console.log(`  status            ${result.status}`);
  console.log(`  messages scanned  ${result.messagesScanned}`);
  console.log(`  messages processed${String(result.messagesProcessed).padStart(3)}`);
  console.log(`  records created   ${result.recordsCreated}`);
  console.log(`  records updated   ${result.recordsUpdated}`);
  console.log(`  records skipped   ${result.recordsSkipped}`);
  console.log(`  records failed    ${result.recordsFailed}`);
  for (const out of result.outputs) {
    console.log(`  output "${out.outputName}": ${out.status} (+${out.created} / ~${out.updated})`);
  }
  if (result.errors.length) {
    console.log('  errors:');
    result.errors.forEach((e) => console.log(`    - ${e}`));
  }

  console.log('\nDemo workspace ready.');
  console.log(`  Sign in with   username: ${DEMO_USERNAME}   password: ${DEMO_PASSWORD}\n`);
}

main()
  .catch((err) => {
    console.error('\nDemo seeding failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
