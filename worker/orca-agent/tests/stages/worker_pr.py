import requests
from prometheus_test.utils import create_signature


def prepare(runner, worker):
    round_state = runner.state["rounds"].get(str(runner.current_round), {})

    if worker.name not in round_state.get("pr_urls", {}):
        print(f"✓ No PR URL found for {worker.name} - continuing")
        return None

    payload = {
        "taskId": runner.config.task_id,
        "action": "add-todo-pr",
        "roundNumber": runner.current_round,
        "prUrl": round_state["pr_urls"][worker.name],
        "stakingKey": worker.staking_public_key,
        "pubKey": worker.public_key,
    }
    return {
        "signature": create_signature(worker.staking_signing_key, payload),
        "stakingKey": worker.staking_public_key,
    }


def execute(runner, worker, data):
    """Add worker PR URL to middle server"""

    if data is None:
        return {"success": True, "message": "Skipped due to missing PR URL"}

    url = f"{runner.config.middle_server_url}/summarizer/worker/add-todo-pr"
    response = requests.post(
        url,
        json={"signature": data["signature"], "stakingKey": data["stakingKey"]},
    )
    result = response.json()

    # Handle 409 gracefully - no eligible todos is an expected case
    if response.status_code == 409:
        print(
            f"✓ {result.get('message', 'No eligible todos')} for {worker.name} - continuing"
        )
        return {"success": True, "message": result.get("message")}
    else:
        response.raise_for_status()

    return result
