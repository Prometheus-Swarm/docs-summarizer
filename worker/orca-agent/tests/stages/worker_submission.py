"""Stage for handling worker submissions."""

import requests
from prometheus_test.utils import create_signature


def prepare(runner, worker):
    """Prepare data for worker submission"""
    pr_url = runner.get(f"pr_urls.{worker.name}")
    if pr_url is None:
        print(f"✓ No pr_urls.{worker.name} found - continuing")
        return None

    # Get submission data from worker
    url = f"{worker.url}/submission/{runner.get('current_round')}"
    response = requests.get(url)
    response.raise_for_status()
    submission_data = response.json()

    # Create signature for the submission
    submitter_payload = {
        "taskId": runner.get("task_id"),
        "roundNumber": runner.get("current_round"),
        "stakingKey": worker.staking_public_key,
        "pubKey": worker.public_key,
        "action": "audit",
        **submission_data,
    }

    return {
        **submission_data,
        "signature": create_signature(worker.staking_signing_key, submitter_payload),
        "stakingKey": worker.staking_public_key,
        "pubKey": worker.public_key,
    }


def execute(runner, worker, data):
    """Store worker submission data"""
    # If prepare returned None, skip this step
    if data is None:
        return {"success": True, "message": "Skipped due to missing PR URL"}

    # Store submission data in state
    runner.set(f"submission_data.{worker.name}", data, scope="round")

    # Return success result
    return {"success": True, "data": data}
