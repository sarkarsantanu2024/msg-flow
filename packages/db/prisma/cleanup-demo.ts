import { PrismaClient } from "@prisma/client";

/**
 * Remove the demo content that `seed.ts` installs, leaving a clean workspace.
 *
 * Deliberately kept:
 *   - plans            — signup looks up the "starter" slug; deleting it breaks
 *                        every future registration
 *   - demo@msgflow.app — the login in active use, its tenant, membership and
 *                        subscription
 *   - the WhatsApp connection row — the paired session directory on the worker
 *                        is named after its id; deleting it forces a re-scan
 *   - real synced groups — anything whose externalId is not one of the four
 *                        fabricated seed ids
 *
 * Removed: fabricated groups, demo messages and classifications, extracted
 * records and their field events, extraction schemas, automations, workflow
 * runs, outputs and sync state, notifications, usage rows, and the
 * operator@msgflow.app account.
 *
 * Idempotent — running it twice deletes nothing the second time.
 */

const prisma = new PrismaClient();

const FAKE_GROUP_IDS = [
  "120363000000000001@g.us",
  "120363000000000002@g.us",
  "120363000000000003@g.us",
  "120363000000000004@g.us",
];

async function main(): Promise<void> {
  const counts: Record<string, number> = {};

  // Child tables first; every deleteMany is scoped wide because the only data
  // these tables can hold at this point is what the seed put there — real
  // captured messages only start existing after a real group is monitored.
  counts.recordSources = (await prisma.recordSource.deleteMany()).count;
  counts.recordFieldEvents = (await prisma.recordFieldEvent.deleteMany()).count;
  counts.outputSyncRecords = (await prisma.outputSyncRecord.deleteMany()).count;
  counts.outputConflicts = (await prisma.outputConflict.deleteMany()).count;
  counts.extractedRecords = (await prisma.extractedRecord.deleteMany()).count;
  counts.classifications = (await prisma.messageClassification.deleteMany()).count;
  counts.messages = (await prisma.message.deleteMany()).count;
  counts.workflowRuns = (await prisma.workflowRun.deleteMany()).count;
  counts.outputVersions = (await prisma.outputVersion.deleteMany()).count;
  counts.outputs = (await prisma.output.deleteMany()).count;
  counts.outputMappings = (await prisma.outputMapping.deleteMany()).count;
  counts.outputTargets = (await prisma.outputTarget.deleteMany()).count;
  counts.automations = (await prisma.automation.deleteMany()).count;
  counts.extractionSchemas = (await prisma.extractionSchema.deleteMany()).count;
  counts.notifications = (await prisma.notification.deleteMany()).count;
  counts.usage = (await prisma.usage.deleteMany()).count;
  counts.exports = (await prisma.export.deleteMany()).count;
  counts.aiUsage = (await prisma.aIUsage.deleteMany()).count;

  counts.fakeGroups = (
    await prisma.whatsAppGroup.deleteMany({
      where: { externalId: { in: FAKE_GROUP_IDS } },
    })
  ).count;

  const operator = await prisma.user.findUnique({
    where: { email: "operator@msgflow.app" },
  });
  if (operator) {
    await prisma.membership.deleteMany({ where: { userId: operator.id } });
    await prisma.user.delete({ where: { id: operator.id } });
    counts.operatorAccount = 1;
  } else {
    counts.operatorAccount = 0;
  }

  for (const [table, count] of Object.entries(counts)) {
    console.log(`${table.padEnd(20)} ${count} deleted`);
  }

  const remainingGroups = await prisma.whatsAppGroup.count();
  console.log(`\nreal groups kept      ${remainingGroups}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
