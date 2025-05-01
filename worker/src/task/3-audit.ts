import { getOrcaClient } from "@_koii/task-manager/extensions";
import { middleServerUrl, status } from "../utils/constant";
import { submissionJSONSignatureDecode } from "../utils/submissionJSONSignatureDecode";
// import { status } from '../utils/constant'
export async function audit(cid: string, roundNumber: number, submitterKey: string): Promise<boolean | void> {
  /**
   * Audit a submission
   * This function should return true if the submission is correct, false otherwise
   * The default implementation retrieves the proofs from IPFS
   * and sends them to your container for auditing
   */

  try {
    const orcaClient = await getOrcaClient();
    if (!orcaClient) {
      // await namespaceWrapper.storeSet(`result-${roundNumber}`, status.NO_ORCA_CLIENT);
      return;
    }
    // Check if the cid is one of the status
    if (Object.values(status).includes(cid)) {
      // This returns a dummy trued
      return true;
    }
    const decodeResult = await submissionJSONSignatureDecode({
      submission_value: cid,
      submitterPublicKey: submitterKey,
      roundNumber: roundNumber, // Decode using the actual round number
    });
    if (!decodeResult) {
      console.log("[AUDIT] DECODE RESULT FAILED.");
      return false;
    }
    console.log(`[AUDIT] ✅ Signature decoded successfully`);

    console.log(`[AUDIT] Checking summarizer status for submitter ${submitterKey}`);
    const checkSummarizerResponse = await fetch(`${middleServerUrl}/summarizer/worker/check-todo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        stakingKey: submitterKey,
        roundNumber, // This round number doesn't matter
        githubUsername: decodeResult.githubUsername,
        prUrl: decodeResult.prUrl,
      }),
    });
    const checkSummarizerJSON = await checkSummarizerResponse.json();
    console.log(`[AUDIT] Summarizer check response:`, checkSummarizerJSON);

    if (!checkSummarizerJSON.success) {
      console.log(`[AUDIT] ❌ Audit failed for ${submitterKey}`);
      return false;
    }
    console.log(`[AUDIT] ✅ Summarizer check passed`);

    console.log(`[AUDIT] Sending audit request for submitter: ${submitterKey}`);
    console.log(`[AUDIT] Submission data being sent to audit:`, decodeResult);

    const auditResult = await orcaClient.podCall(`worker-audit/${decodeResult.roundNumber}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        submission: decodeResult,
      }),
    });
    console.log(`[AUDIT] Audit result:`, auditResult);
    const auditResultJson = await auditResult.json();
    console.log(`[AUDIT] Audit result JSON:`, auditResultJson);
    // Add extra error handling for https://koii-workspace.slack.com/archives/C0886H01JM8/p1746137232538419
    // check if this .data have success, if not check .data.data have success
    let auditResultDataJson;
    if (typeof auditResult.data === 'object' && 'success' in auditResult.data) {
      console.log("[AUDIT] Audit result data is an object with 'success' property");
      auditResultDataJson = auditResult.data;
    } else if (typeof auditResult.data === 'object' && 'data' in auditResult.data && 'success' in auditResult.data.data) {
      console.log("[AUDIT] Audit result data is an object with 'data' property and 'success' property");
      auditResultDataJson = auditResult.data.data;
    } else {
      console.log(`[AUDIT] ❌ Audit result is not a valid object`);
      return true;
    }
    console.log("[AUDIT] Audit result data JSON:", auditResultDataJson);

    if (auditResultDataJson.success) {
      console.log(`[AUDIT] ✅ Audit successful for ${submitterKey}`);
      return auditResultDataJson.data.is_approved;
    } else {
      console.log(`[AUDIT] ❌ Audit could not be completed for ${submitterKey}`);
      return true;
    }
  } catch (error) {
    console.error("[AUDIT] Error auditing submission:", error);

    // When Error---NO RETURN;
    // return true;
  }
}