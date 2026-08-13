import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Development seed.
 *
 * Produces a workspace that already looks alive: monitored groups, a week of
 * realistic WhatsApp traffic, classified messages, extracted records (including
 * some that need review), outputs with mappings, and workflow-run history.
 *
 * Idempotent — safe to run repeatedly.
 */

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@msgflow.app";
const DEMO_PASSWORD = "msgflow-demo-2026";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function daysAgo(days: number, hour = 10, minute = 30): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, minute, 0, 0);
  return date;
}

/** Messages that exercise the real shapes: units, ₹ rates, dd/mm dates, Hinglish. */
const SALES_MESSAGES = [
  "ABC Traders require 50 kg Product X at ₹250/kg. Delivery by 15/08.",
  "Sunrise Enterprises need 120 pcs Product Y, rate 180. Please confirm.",
  "Good morning all",
  "Metro Supplies enquiry — 30 kg Product X, they are asking best rate.",
  "ABC Traders updated their order: now 75 kg Product X, same rate.",
  "Kumar Industries wants a quotation for 200 pcs Product Z by tomorrow.",
  "Thanks 👍",
  "New enquiry from Deepak Trading: 60 kg Product Y at ₹195/kg, delivery 20/08.",
  "Sunrise Enterprises confirmed. Order value approx 21600.",
  "Please send the updated price list to all customers",
];

const INVENTORY_MESSAGES = [
  "Stock update: Product X is now 340 kg in the main godown.",
  "Product Y stock reduced to 85 pcs after this morning dispatch.",
  "Product Z out of stock. Restocking on 18/08.",
  "ok noted",
  "Product X stock is now 275 kg after the ABC Traders dispatch.",
  "Godown 2: Product Y 45 pcs remaining.",
];

const DELIVERY_MESSAGES = [
  "ORD-1041 dispatched via Sharma Transport, LR no 88214. Delivery expected 16/08.",
  "ORD-1042 delivered to Sunrise Enterprises today.",
  "ORD-1041 delayed — vehicle breakdown near Nashik. New ETA 17/08.",
];

async function main() {
  console.log("Seeding MsgFlow development data…\n");

  // ---- Plans ---------------------------------------------------------------
  const plans = [
    {
      slug: "starter",
      name: "Starter",
      priceInr: 0,
      limits: {
        messagesPerMonth: 5_000,
        aiCallsPerMonth: 2_000,
        automations: 3,
        outputs: 3,
        seats: 3,
      },
      features: [
        "1 WhatsApp connection",
        "Excel & CSV outputs",
        "Real-time and daily processing",
      ],
    },
    {
      slug: "growth",
      name: "Growth",
      priceInr: 4_999,
      limits: {
        messagesPerMonth: 50_000,
        aiCallsPerMonth: 25_000,
        automations: 25,
        outputs: 25,
        seats: 10,
      },
      features: [
        "Everything in Starter",
        "Google Sheets & REST API outputs",
        "Weekly and monthly reports",
        "Version history",
      ],
    },
    {
      slug: "scale",
      name: "Scale",
      priceInr: 14_999,
      limits: {
        messagesPerMonth: 500_000,
        aiCallsPerMonth: 250_000,
        automations: 200,
        outputs: 200,
        seats: 50,
      },
      features: [
        "Everything in Growth",
        "Client website & admin sync",
        "Priority support",
        "Custom retention",
      ],
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { slug: plan.slug },
      create: {
        slug: plan.slug,
        name: plan.name,
        priceInr: plan.priceInr,
        limits: plan.limits as Prisma.InputJsonValue,
        features: plan.features as Prisma.InputJsonValue,
      },
      update: {
        name: plan.name,
        priceInr: plan.priceInr,
        limits: plan.limits as Prisma.InputJsonValue,
        features: plan.features as Prisma.InputJsonValue,
      },
    });
  }
  console.log(`✓ ${plans.length} plans`);

  // ---- Tenant + users ------------------------------------------------------
  const tenant = await prisma.tenant.upsert({
    where: { slug: "acme-trading" },
    create: {
      name: "Acme Trading Co.",
      slug: "acme-trading",
      status: "ACTIVE",
      timezone: "Asia/Kolkata",
    },
    update: {},
  });

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const owner = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    create: {
      email: DEMO_EMAIL,
      name: "Demo Owner",
      passwordHash,
      isSuperAdmin: true,
      emailVerifiedAt: new Date(),
    },
    update: { passwordHash, isSuperAdmin: true },
  });

  const operator = await prisma.user.upsert({
    where: { email: "operator@msgflow.app" },
    create: {
      email: "operator@msgflow.app",
      name: "Priya Operator",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
    update: { passwordHash },
  });

  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: owner.id } },
    create: { tenantId: tenant.id, userId: owner.id, role: "OWNER" },
    update: { role: "OWNER" },
  });

  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: operator.id } },
    create: { tenantId: tenant.id, userId: operator.id, role: "OPERATOR" },
    update: { role: "OPERATOR" },
  });

  const growthPlan = await prisma.plan.findUnique({
    where: { slug: "growth" },
  });
  if (growthPlan) {
    await prisma.subscription.upsert({
      where: { tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        planId: growthPlan.id,
        status: "ACTIVE",
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      },
      update: { planId: growthPlan.id, status: "ACTIVE" },
    });
  }
  console.log("✓ Tenant, users and subscription");

  // ---- WhatsApp connection + groups ---------------------------------------
  const connection = await prisma.whatsAppConnection.upsert({
    where: { id: `seed-connection-${tenant.id}` },
    create: {
      id: `seed-connection-${tenant.id}`,
      tenantId: tenant.id,
      name: "Primary WhatsApp",
      provider: "WHATSAPP_WEB",
      // Seeded as disconnected: claiming READY without a live session would be
      // a lie the dashboard immediately contradicts.
      status: "DISCONNECTED",
      phoneNumber: "+919876543210",
    },
    update: {},
  });

  const groupDefinitions = [
    {
      externalId: "120363000000000001@g.us",
      name: "Sales Team",
      participants: 12,
    },
    {
      externalId: "120363000000000002@g.us",
      name: "Inventory Updates",
      participants: 8,
    },
    {
      externalId: "120363000000000003@g.us",
      name: "Dispatch & Delivery",
      participants: 15,
    },
    {
      externalId: "120363000000000004@g.us",
      name: "Management",
      participants: 5,
    },
  ];

  const groups = [];
  for (const [index, definition] of groupDefinitions.entries()) {
    groups.push(
      await prisma.whatsAppGroup.upsert({
        where: {
          connectionId_externalId: {
            connectionId: connection.id,
            externalId: definition.externalId,
          },
        },
        create: {
          tenantId: tenant.id,
          connectionId: connection.id,
          externalId: definition.externalId,
          name: definition.name,
          participantCount: definition.participants,
          // The last group stays unmonitored so the Groups screen shows both states.
          isMonitored: index < 3,
          monitoredAt: index < 3 ? daysAgo(30) : null,
        },
        update: {},
      }),
    );
  }
  console.log(`✓ ${groups.length} WhatsApp groups (3 monitored)`);

  // ---- Extraction schemas --------------------------------------------------
  const salesSchema = await prisma.extractionSchema.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: "sales-enquiry" } },
    create: {
      tenantId: tenant.id,
      name: "Sales Enquiry",
      slug: "sales-enquiry",
      description: "Customer enquiries and orders from the sales group",
      confidenceThreshold: 0.7,
      fields: {
        create: [
          {
            key: "date",
            label: "Date",
            type: "DATE",
            required: true,
            isKeyField: true,
            order: 0,
            description: "Date of the enquiry",
          },
          {
            key: "customerName",
            label: "Customer",
            type: "STRING",
            required: true,
            isKeyField: true,
            order: 1,
            description: "Customer or company name",
          },
          {
            key: "product",
            label: "Product",
            type: "STRING",
            required: true,
            isKeyField: true,
            order: 2,
            description: "Product enquired about",
          },
          {
            key: "quantity",
            label: "Quantity",
            type: "DECIMAL",
            required: false,
            order: 3,
            description: "Quantity requested",
          },
          {
            key: "unit",
            label: "Unit",
            type: "STRING",
            required: false,
            order: 4,
            description: "Unit of measure",
          },
          {
            key: "rate",
            label: "Rate",
            type: "CURRENCY",
            required: false,
            order: 5,
            description: "Rate per unit in INR",
          },
          {
            key: "salesPerson",
            label: "Sales Person",
            type: "STRING",
            required: false,
            order: 6,
            description: "Who reported it",
          },
        ],
      },
    },
    update: {},
    include: { fields: true },
  });

  const inventorySchema = await prisma.extractionSchema.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: "inventory-update" } },
    create: {
      tenantId: tenant.id,
      name: "Inventory Update",
      slug: "inventory-update",
      description: "Stock levels reported in the inventory group",
      confidenceThreshold: 0.7,
      fields: {
        create: [
          {
            key: "product",
            label: "Product",
            type: "STRING",
            required: true,
            isKeyField: true,
            order: 0,
          },
          {
            key: "stock",
            label: "Stock",
            type: "DECIMAL",
            required: true,
            order: 1,
          },
          {
            key: "unit",
            label: "Unit",
            type: "STRING",
            required: false,
            order: 2,
          },
          {
            key: "location",
            label: "Location",
            type: "STRING",
            required: false,
            order: 3,
          },
          {
            key: "date",
            label: "Date",
            type: "DATE",
            required: false,
            order: 4,
          },
        ],
      },
    },
    update: {},
    include: { fields: true },
  });

  const deliverySchema = await prisma.extractionSchema.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: "delivery-update" } },
    create: {
      tenantId: tenant.id,
      name: "Delivery Update",
      slug: "delivery-update",
      description: "Dispatch and delivery status",
      confidenceThreshold: 0.7,
      fields: {
        create: [
          {
            key: "orderId",
            label: "Order ID",
            type: "STRING",
            required: true,
            isKeyField: true,
            order: 0,
          },
          {
            key: "status",
            label: "Status",
            type: "ENUM",
            required: false,
            order: 1,
            enumValues: ["Dispatched", "In transit", "Delivered", "Delayed"],
          },
          {
            key: "customerName",
            label: "Customer",
            type: "STRING",
            required: false,
            order: 2,
          },
          {
            key: "vehicle",
            label: "Vehicle / LR",
            type: "STRING",
            required: false,
            order: 3,
          },
          {
            key: "date",
            label: "Date",
            type: "DATE",
            required: false,
            order: 4,
          },
        ],
      },
    },
    update: {},
    include: { fields: true },
  });
  console.log("✓ 3 extraction schemas");

  // ---- Messages ------------------------------------------------------------
  const senders = [
    { id: "919876543211@c.us", name: "Rahul Sharma", phone: "+919876543211" },
    { id: "919876543212@c.us", name: "Priya Nair", phone: "+919876543212" },
    { id: "919876543213@c.us", name: "Amit Patel", phone: "+919876543213" },
  ];

  const messageSets = [
    { group: groups[0], texts: SALES_MESSAGES, category: "SALES" as const },
    {
      group: groups[1],
      texts: INVENTORY_MESSAGES,
      category: "INVENTORY" as const,
    },
    {
      group: groups[2],
      texts: DELIVERY_MESSAGES,
      category: "DELIVERY" as const,
    },
  ];

  const createdMessages: Array<{
    id: string;
    text: string;
    groupIndex: number;
    timestamp: Date;
  }> = [];
  let messageCounter = 0;

  for (const [setIndex, set] of messageSets.entries()) {
    for (const [index, text] of set.texts.entries()) {
      messageCounter++;
      const sender = senders[index % senders.length];
      // Spread across the last 7 days so the charts have shape.
      const timestamp = daysAgo(
        6 - Math.floor(index / 2),
        9 + (index % 8),
        (index * 13) % 60,
      );
      const externalId = `seed-msg-${setIndex}-${index}`;

      const isNoise = /^(good morning all|thanks|ok noted)/i.test(text);

      const message = await prisma.message.upsert({
        where: { tenantId_externalId: { tenantId: tenant.id, externalId } },
        create: {
          tenantId: tenant.id,
          connectionId: connection.id,
          groupId: set.group.id,
          externalId,
          contentHash: sha256(
            `${set.group.externalId}|${sender.id}|${timestamp.getTime()}|${text}`,
          ),
          senderId: sender.id,
          senderName: sender.name,
          senderPhone: sender.phone,
          text,
          messageType: "TEXT",
          timestamp,
          receivedAt: timestamp,
          ingestSource: "LIVE",
          status: isNoise ? "IGNORED" : "EXTRACTED",
        },
        update: {},
      });

      await prisma.messageClassification.upsert({
        where: { messageId: message.id },
        create: {
          tenantId: tenant.id,
          messageId: message.id,
          category: isNoise ? "IGNORE" : set.category,
          importance: isNoise ? "IGNORE" : "HIGH",
          confidence: isNoise ? 0.95 : 0.78 + (index % 4) * 0.05,
          reasoning: isNoise
            ? "Greeting or acknowledgement with no business content."
            : `Matched ${set.category.toLowerCase()} patterns with concrete entities.`,
          entities: {} as Prisma.InputJsonValue,
          provider: "mock",
          model: "mock-rules-v1",
          inputTokens: Math.ceil(text.length / 4),
          outputTokens: 40,
        },
        update: {},
      });

      if (!isNoise) {
        createdMessages.push({
          id: message.id,
          text,
          groupIndex: setIndex,
          timestamp,
        });
      }
    }
  }
  console.log(`✓ ${messageCounter} messages with classifications`);

  // ---- Outputs -------------------------------------------------------------
  const masterExcel = await prisma.output.upsert({
    where: { id: `seed-output-excel-${tenant.id}` },
    create: {
      id: `seed-output-excel-${tenant.id}`,
      tenantId: tenant.id,
      name: "Master Sales",
      type: "EXCEL",
      status: "ACTIVE",
      config: {
        fileName: "Master Sales.xlsx",
        worksheet: "Sales",
        headerRow: 1,
        columns: [
          "Date",
          "Customer",
          "Product",
          "Quantity",
          "Unit",
          "Rate",
          "Salesperson",
        ],
      } as Prisma.InputJsonValue,
      recordCount: 0,
      createdBy: owner.id,
    },
    update: {},
  });

  const stockSheet = await prisma.output.upsert({
    where: { id: `seed-output-sheets-${tenant.id}` },
    create: {
      id: `seed-output-sheets-${tenant.id}`,
      tenantId: tenant.id,
      name: "Live Stock Sheet",
      type: "GOOGLE_SHEETS",
      status: "ACTIVE",
      config: {
        spreadsheetId: "REPLACE_WITH_YOUR_SPREADSHEET_ID",
        worksheetTitle: "Stock",
        headerRow: 1,
        columns: ["Product", "Stock", "Unit", "Location", "Updated"],
      } as Prisma.InputJsonValue,
      createdBy: owner.id,
    },
    update: {},
  });

  const dailyReport = await prisma.output.upsert({
    where: { id: `seed-output-pdf-${tenant.id}` },
    create: {
      id: `seed-output-pdf-${tenant.id}`,
      tenantId: tenant.id,
      name: "Daily Sales Report",
      type: "PDF",
      status: "ACTIVE",
      config: {
        fileName: "daily-sales",
        title: "Daily Sales Report",
        columns: [],
      } as Prisma.InputJsonValue,
      createdBy: owner.id,
    },
    update: {},
  });
  console.log("✓ 3 outputs (Excel, Google Sheets, PDF)");

  // ---- Automations ---------------------------------------------------------
  const salesAutomation = await prisma.automation.upsert({
    where: { id: `seed-automation-sales-${tenant.id}` },
    create: {
      id: `seed-automation-sales-${tenant.id}`,
      tenantId: tenant.id,
      name: "Sales Enquiry Extraction",
      description:
        "Reads the Sales Team group and keeps Master Sales.xlsx up to date.",
      status: "ACTIVE",
      schemaId: salesSchema.id,
      processingMode: "REAL_TIME",
      dateRangeMode: "SINCE_LAST_SUCCESSFUL_RUN",
      requireImportant: true,
      minImportance: "MEDIUM",
      minConfidence: 0.7,
      lastSuccessfulRunAt: daysAgo(0, 8, 0),
      lastRunAt: daysAgo(0, 8, 0),
      createdBy: owner.id,
      triggers: {
        create: [
          {
            tenantId: tenant.id,
            type: "REAL_TIME",
            groupId: groups[0].id,
            enabled: true,
          },
        ],
      },
    },
    update: {},
  });

  const inventoryAutomation = await prisma.automation.upsert({
    where: { id: `seed-automation-inventory-${tenant.id}` },
    create: {
      id: `seed-automation-inventory-${tenant.id}`,
      tenantId: tenant.id,
      name: "Inventory Sync",
      description:
        "Keeps the live stock sheet in step with what the team reports.",
      status: "ACTIVE",
      schemaId: inventorySchema.id,
      processingMode: "DAILY",
      dateRangeMode: "TODAY",
      scheduleHour: 23,
      scheduleMinute: 0,
      cronExpression: "0 23 * * *",
      requireImportant: true,
      minConfidence: 0.7,
      nextRunAt: new Date(Date.now() + 12 * 3_600_000),
      createdBy: owner.id,
      triggers: {
        create: [
          {
            tenantId: tenant.id,
            type: "SCHEDULE",
            groupId: groups[1].id,
            enabled: true,
          },
        ],
      },
    },
    update: {},
  });

  await prisma.automation.upsert({
    where: { id: `seed-automation-delivery-${tenant.id}` },
    create: {
      id: `seed-automation-delivery-${tenant.id}`,
      tenantId: tenant.id,
      name: "Delivery Tracking",
      description: "Tracks dispatch and delivery status by order number.",
      status: "DRAFT",
      schemaId: deliverySchema.id,
      processingMode: "REAL_TIME",
      dateRangeMode: "SINCE_LAST_SUCCESSFUL_RUN",
      createdBy: owner.id,
      triggers: {
        create: [
          {
            tenantId: tenant.id,
            type: "REAL_TIME",
            groupId: groups[2].id,
            enabled: true,
          },
        ],
      },
    },
    update: {},
  });
  console.log("✓ 3 automations (2 active, 1 draft)");

  // ---- Output targets + mappings ------------------------------------------
  await prisma.outputTarget.upsert({
    where: {
      automationId_outputId: {
        automationId: salesAutomation.id,
        outputId: masterExcel.id,
      },
    },
    create: {
      tenantId: tenant.id,
      automationId: salesAutomation.id,
      outputId: masterExcel.id,
      operation: "UPSERT",
      enabled: true,
      mappings: {
        create: [
          {
            tenantId: tenant.id,
            sourceField: "date",
            targetField: "Date",
            isKeyPart: true,
            keyOrder: 0,
            order: 0,
            updateStrategy: "NEVER_UPDATE",
          },
          {
            tenantId: tenant.id,
            sourceField: "customerName",
            targetField: "Customer",
            isKeyPart: true,
            keyOrder: 1,
            order: 1,
            updateStrategy: "NEVER_UPDATE",
          },
          {
            tenantId: tenant.id,
            sourceField: "product",
            targetField: "Product",
            isKeyPart: true,
            keyOrder: 2,
            order: 2,
            updateStrategy: "NEVER_UPDATE",
          },
          {
            tenantId: tenant.id,
            sourceField: "quantity",
            targetField: "Quantity",
            order: 3,
            updateStrategy: "ALWAYS_UPDATE",
          },
          {
            tenantId: tenant.id,
            sourceField: "unit",
            targetField: "Unit",
            order: 4,
            updateStrategy: "UPDATE_IF_EMPTY",
          },
          {
            tenantId: tenant.id,
            sourceField: "rate",
            targetField: "Rate",
            order: 5,
            updateStrategy: "ALWAYS_UPDATE",
          },
          {
            tenantId: tenant.id,
            sourceField: "salesPerson",
            targetField: "Salesperson",
            order: 6,
            updateStrategy: "UPDATE_IF_EMPTY",
          },
        ],
      },
    },
    update: {},
  });

  await prisma.outputTarget.upsert({
    where: {
      automationId_outputId: {
        automationId: salesAutomation.id,
        outputId: dailyReport.id,
      },
    },
    create: {
      tenantId: tenant.id,
      automationId: salesAutomation.id,
      outputId: dailyReport.id,
      operation: "GENERATE_NEW_VERSION",
      enabled: true,
      order: 1,
      mappings: {
        create: [
          {
            tenantId: tenant.id,
            sourceField: "date",
            targetField: "Date",
            order: 0,
          },
          {
            tenantId: tenant.id,
            sourceField: "customerName",
            targetField: "Customer",
            order: 1,
          },
          {
            tenantId: tenant.id,
            sourceField: "product",
            targetField: "Product",
            order: 2,
          },
          {
            tenantId: tenant.id,
            sourceField: "quantity",
            targetField: "Quantity",
            order: 3,
          },
          {
            tenantId: tenant.id,
            sourceField: "rate",
            targetField: "Rate",
            order: 4,
          },
        ],
      },
    },
    update: {},
  });

  await prisma.outputTarget.upsert({
    where: {
      automationId_outputId: {
        automationId: inventoryAutomation.id,
        outputId: stockSheet.id,
      },
    },
    create: {
      tenantId: tenant.id,
      automationId: inventoryAutomation.id,
      outputId: stockSheet.id,
      operation: "UPSERT",
      enabled: true,
      mappings: {
        create: [
          {
            tenantId: tenant.id,
            sourceField: "product",
            targetField: "Product",
            isKeyPart: true,
            keyOrder: 0,
            order: 0,
            updateStrategy: "NEVER_UPDATE",
          },
          {
            tenantId: tenant.id,
            sourceField: "stock",
            targetField: "Stock",
            order: 1,
            updateStrategy: "ALWAYS_UPDATE",
          },
          {
            tenantId: tenant.id,
            sourceField: "unit",
            targetField: "Unit",
            order: 2,
            updateStrategy: "UPDATE_IF_EMPTY",
          },
          {
            tenantId: tenant.id,
            sourceField: "location",
            targetField: "Location",
            order: 3,
            updateStrategy: "ALWAYS_UPDATE",
          },
          {
            tenantId: tenant.id,
            sourceField: "date",
            targetField: "Updated",
            order: 4,
            updateStrategy: "ALWAYS_UPDATE",
          },
        ],
      },
    },
    update: {},
  });
  console.log("✓ Output targets with field mappings and unique keys");

  // ---- Extracted records ---------------------------------------------------
  const salesRecords = [
    {
      date: "2026-08-08",
      customerName: "ABC Traders",
      product: "Product X",
      quantity: 75,
      unit: "kg",
      rate: 250,
      salesPerson: "Rahul Sharma",
      confidence: 0.93,
    },
    {
      date: "2026-08-08",
      customerName: "Sunrise Enterprises",
      product: "Product Y",
      quantity: 120,
      unit: "pcs",
      rate: 180,
      salesPerson: "Priya Nair",
      confidence: 0.9,
    },
    {
      date: "2026-08-09",
      customerName: "Metro Supplies",
      product: "Product X",
      quantity: 30,
      unit: "kg",
      salesPerson: "Amit Patel",
      confidence: 0.71,
    },
    {
      date: "2026-08-10",
      customerName: "Kumar Industries",
      product: "Product Z",
      quantity: 200,
      unit: "pcs",
      salesPerson: "Rahul Sharma",
      confidence: 0.64,
    },
    {
      date: "2026-08-11",
      customerName: "Deepak Trading",
      product: "Product Y",
      quantity: 60,
      unit: "kg",
      rate: 195,
      salesPerson: "Priya Nair",
      confidence: 0.88,
    },
  ];

  let recordIndex = 0;
  for (const data of salesRecords) {
    const naturalKey = `${data.date}|${data.customerName.toLowerCase()}|${data.product.toLowerCase()}`;
    const naturalKeyHash = sha256(`${salesSchema.id}:${naturalKey}`);
    const sourceMessage = createdMessages[recordIndex % createdMessages.length];
    const belowThreshold = data.confidence < 0.7;

    const record = await prisma.extractedRecord.upsert({
      where: {
        tenantId_schemaId_naturalKeyHash: {
          tenantId: tenant.id,
          schemaId: salesSchema.id,
          naturalKeyHash,
        },
      },
      create: {
        tenantId: tenant.id,
        schemaId: salesSchema.id,
        automationId: salesAutomation.id,
        naturalKey,
        naturalKeyHash,
        data: data as unknown as Prisma.InputJsonValue,
        // One record deliberately lands below the threshold so the review queue
        // is not empty on a fresh install.
        status: belowThreshold ? "NEEDS_REVIEW" : "VALIDATED",
        confidence: data.confidence,
        version: 1,
        originMessageId: sourceMessage?.id ?? null,
        firstSeenAt: sourceMessage?.timestamp ?? daysAgo(3),
        lastEventAt: sourceMessage?.timestamp ?? daysAgo(3),
      },
      update: {},
    });

    if (sourceMessage) {
      await prisma.recordSource
        .create({
          data: {
            tenantId: tenant.id,
            recordId: record.id,
            messageId: sourceMessage.id,
            isOrigin: true,
            confidence: data.confidence,
          },
        })
        .catch(() => undefined);

      await prisma.recordFieldEvent.createMany({
        data: Object.entries(data)
          .filter(([key]) => key !== "confidence")
          .map(([fieldKey, newValue]) => ({
            tenantId: tenant.id,
            recordId: record.id,
            fieldKey,
            newValue: newValue as Prisma.InputJsonValue,
            eventAt: sourceMessage.timestamp,
            applied: true,
            messageId: sourceMessage.id,
          })),
        skipDuplicates: true,
      });
    }

    await prisma.outputSyncRecord.upsert({
      where: {
        outputId_recordId: { outputId: masterExcel.id, recordId: record.id },
      },
      create: {
        tenantId: tenant.id,
        outputId: masterExcel.id,
        recordId: record.id,
        externalRowId: String(recordIndex + 2),
        syncStatus: belowThreshold ? "PENDING" : "SYNCED",
        syncVersion: belowThreshold ? 0 : 1,
        lastSyncedAt: belowThreshold ? null : daysAgo(0, 8, 5),
      },
      update: {},
    });

    recordIndex++;
  }

  // The ABC Traders quantity change: 50 kg → 75 kg, showing field history.
  const abcKey = `2026-08-08|abc traders|product x`;
  const abcRecord = await prisma.extractedRecord.findUnique({
    where: {
      tenantId_schemaId_naturalKeyHash: {
        tenantId: tenant.id,
        schemaId: salesSchema.id,
        naturalKeyHash: sha256(`${salesSchema.id}:${abcKey}`),
      },
    },
  });

  if (abcRecord) {
    await prisma.recordFieldEvent.createMany({
      data: [
        {
          tenantId: tenant.id,
          recordId: abcRecord.id,
          fieldKey: "quantity",
          previousValue: 50 as unknown as Prisma.InputJsonValue,
          newValue: 75 as unknown as Prisma.InputJsonValue,
          eventAt: daysAgo(4, 14, 20),
          applied: true,
        },
      ],
      skipDuplicates: true,
    });
    await prisma.extractedRecord.update({
      where: { id: abcRecord.id },
      data: { version: 2 },
    });
  }

  const inventoryRecords = [
    {
      product: "Product X",
      stock: 275,
      unit: "kg",
      location: "Main godown",
      date: "2026-08-11",
      confidence: 0.91,
    },
    {
      product: "Product Y",
      stock: 45,
      unit: "pcs",
      location: "Godown 2",
      date: "2026-08-11",
      confidence: 0.87,
    },
    {
      product: "Product Z",
      stock: 0,
      unit: "pcs",
      location: "Main godown",
      date: "2026-08-10",
      confidence: 0.82,
    },
  ];

  for (const data of inventoryRecords) {
    const naturalKey = data.product.toLowerCase();
    const naturalKeyHash = sha256(`${inventorySchema.id}:${naturalKey}`);
    await prisma.extractedRecord.upsert({
      where: {
        tenantId_schemaId_naturalKeyHash: {
          tenantId: tenant.id,
          schemaId: inventorySchema.id,
          naturalKeyHash,
        },
      },
      create: {
        tenantId: tenant.id,
        schemaId: inventorySchema.id,
        automationId: inventoryAutomation.id,
        naturalKey,
        naturalKeyHash,
        data: data as unknown as Prisma.InputJsonValue,
        status: "VALIDATED",
        confidence: data.confidence,
        version: 2,
        firstSeenAt: daysAgo(5),
        lastEventAt: daysAgo(1),
      },
      update: {},
    });
  }
  console.log(
    `✓ ${salesRecords.length + inventoryRecords.length} extracted records (1 needs review)`,
  );

  await prisma.output.update({
    where: { id: masterExcel.id },
    data: {
      recordCount: salesRecords.length,
      lastSyncAt: daysAgo(0, 8, 5),
      lastSyncStatus: "SUCCESS",
    },
  });

  // ---- Workflow runs -------------------------------------------------------
  for (let day = 6; day >= 0; day--) {
    const runId = `seed-run-${tenant.id}-${day}`;
    const failed = day === 3;

    await prisma.workflowRun.upsert({
      where: { id: runId },
      create: {
        id: runId,
        tenantId: tenant.id,
        automationId: salesAutomation.id,
        trigger: day % 2 === 0 ? "SCHEDULE" : "REAL_TIME",
        status: failed ? "PARTIAL_SUCCESS" : "SUCCESS",
        windowStart: daysAgo(day, 0, 0),
        windowEnd: daysAgo(day, 23, 59),
        messagesScanned: 8 + day,
        messagesProcessed: 5 + day,
        recordsCreated: day % 3,
        recordsUpdated: 1 + (day % 2),
        recordsSkipped: 2,
        recordsFailed: failed ? 1 : 0,
        rowsCreated: day % 3,
        rowsUpdated: 1 + (day % 2),
        rowsSkipped: 2,
        rowsFailed: failed ? 1 : 0,
        inputTokens: 1_200 + day * 80,
        outputTokens: 300 + day * 20,
        costUsd: new Prisma.Decimal(0.0042 + day * 0.0003),
        errorMessage: failed
          ? 'One row could not be written: the destination column "Rate" was locked.'
          : null,
        summary: {
          windowLabel: "Since last successful run",
          outputs: [
            {
              name: "Master Sales",
              status: failed ? "PARTIAL_SUCCESS" : "SUCCESS",
              created: day % 3,
              updated: 1 + (day % 2),
              skipped: 2,
              failed: failed ? 1 : 0,
            },
          ],
          warnings: [],
        } as Prisma.InputJsonValue,
        queuedAt: daysAgo(day, 23, 0),
        startedAt: daysAgo(day, 23, 0),
        finishedAt: daysAgo(day, 23, 2),
      },
      update: {},
    });
  }
  console.log("✓ 7 days of workflow run history");

  // ---- Usage ---------------------------------------------------------------
  for (let day = 6; day >= 0; day--) {
    const periodStart = daysAgo(day, 0, 0);
    await prisma.usage.upsert({
      where: { tenantId_periodStart: { tenantId: tenant.id, periodStart } },
      create: {
        tenantId: tenant.id,
        periodStart,
        messages: 12 + day * 3,
        aiCalls: 8 + day * 2,
        inputTokens: 1_400 + day * 120,
        outputTokens: 360 + day * 30,
        costUsd: new Prisma.Decimal(0.005 + day * 0.0004),
        automationRuns: 1,
        workflowRuns: 1,
        recordsCreated: day % 3,
        recordsUpdated: 1 + (day % 2),
      },
      update: {},
    });
  }
  console.log("✓ 7 days of usage metering");

  // ---- Notifications -------------------------------------------------------
  await prisma.notification.createMany({
    data: [
      {
        tenantId: tenant.id,
        severity: "WARNING",
        code: "REVIEW_REQUIRED",
        title: "1 record needs review",
        body: "The Kumar Industries enquiry was extracted with low confidence.",
        link: "/dashboard/review",
      },
      {
        tenantId: tenant.id,
        severity: "INFO",
        code: "WELCOME",
        title: "Welcome to MsgFlow",
        body: "Connect WhatsApp to start capturing messages, or try Demo Mode first.",
        link: "/dashboard/whatsapp",
      },
    ],
    skipDuplicates: true,
  });

  console.log("\n─────────────────────────────────────────────");
  console.log("Seed complete.\n");
  console.log("  Sign in at https://msg-flow.vercel.app/login");
  console.log(`  Email:    ${DEMO_EMAIL}`);
  console.log(`  Password: ${DEMO_PASSWORD}`);
  console.log(`\n  Operator account: operator@msgflow.app (same password)`);
  console.log("  The owner account is also a platform super admin (/admin).");
  console.log("─────────────────────────────────────────────\n");
  void randomBytes;
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
