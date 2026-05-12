import os
import json
import time
import yaml
import requests
from datetime import datetime, timezone, timedelta

GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
ORG          = os.environ.get("GITHUB_ORG")
OUTPUT_DIR   = os.environ.get("OUTPUT_DIR")
GROUPS_PATH  = os.environ.get("GROUPS_PATH")

HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

BASE = "https://api.github.com"


# ── retry wrapper ───────────────────────────────────────────────────────────

def gh_get(url, params=None):
    for attempt in range(3):
        response = requests.get(url, headers=HEADERS, params=params, timeout=20)

        if response.status_code == 403:
            reset = int(response.headers.get("X-RateLimit-Reset", time.time() + 60))
            wait = max(reset - time.time(), 0) + 5
            print(f"  Rate limited — sleeping {wait:.0f}s")
            time.sleep(wait)
            continue

        if response.status_code == 404:
            return None

        response.raise_for_status()
        return response.json()

    return None


def gh_get_all_pages(url, params=None, list_key=None):
    """Fetch all pages of a paginated GitHub API endpoint."""
    results = []
    next_url = url
    req_params = dict(params or {})
    req_params.setdefault("per_page", 100)

    while next_url:
        for attempt in range(3):
            response = requests.get(next_url, headers=HEADERS,
                                    params=req_params if next_url == url else None,
                                    timeout=20)
            if response.status_code == 403:
                reset = int(response.headers.get("X-RateLimit-Reset", time.time() + 60))
                wait = max(reset - time.time(), 0) + 5
                print(f"  Rate limited — sleeping {wait:.0f}s")
                time.sleep(wait)
                continue
            if response.status_code == 404:
                return results
            response.raise_for_status()
            data = response.json()
            page_items = data.get(list_key, data) if list_key else data
            if isinstance(page_items, list):
                results.extend(page_items)
            # follow Link: <url>; rel="next"
            link = response.headers.get("Link", "")
            next_url = None
            for part in link.split(","):
                part = part.strip()
                if 'rel="next"' in part:
                    next_url = part.split(";")[0].strip().strip("<>")
            break
        else:
            break

    return results


# ── groups config ───────────────────────────────────────────────────────────

def load_groups():
    candidate_paths = [GROUPS_PATH]
    if GROUPS_PATH == "groups.yml":
        candidate_paths.append("group.yml")
    elif GROUPS_PATH == "group.yml":
        candidate_paths.append("groups.yml")

    for path in candidate_paths:
        try:
            with open(path) as f:
                config = yaml.safe_load(f) or {}
            
            # New format: repos list with program_name per repo
            repos_list = config.get("repos", [])
            if repos_list and isinstance(repos_list, list):
                mapping = {}
                for repo_entry in repos_list:
                    if isinstance(repo_entry, dict):
                        repo_name = repo_entry.get("name")
                        program_name = repo_entry.get("program_name")
                        if repo_name and program_name:
                            mapping[repo_name] = program_name
                if mapping:
                    return mapping
            
            # Legacy format: groups dict with repo lists
            mapping = {}
            for group, repos in config.get("groups", {}).items():
                for repo in (repos or []):
                    mapping[repo] = group
            if mapping:
                return mapping
            
            print(f"Warning: no repos configured in {path}")
            return {}
        except FileNotFoundError:
            continue

    print(f"Warning: groups config not found (tried: {', '.join(candidate_paths)})")
    return {}


# ── fetchers ────────────────────────────────────────────────────────────────

def get_repos(repo_names):
    repos = []
    for name in sorted(repo_names):
        repo = gh_get(f"{BASE}/repos/{ORG}/{name}")
        if repo is None:
            print(f"  Skipping {name}: repository not found or inaccessible")
            continue
        repos.append(repo)
    return repos


def get_workflow_runs(repo_name):
    """Fetch ALL runs via pagination. Returns headline metrics + full run list for runs/."""
    runs = gh_get_all_pages(
        f"{BASE}/repos/{ORG}/{repo_name}/actions/runs",
        list_key="workflow_runs",
    )
    if not runs:
        return None, []

    completed = [r for r in runs if r.get("status") == "completed"]

    if not completed:
        return None, runs

    # headline metrics
    successes    = [r for r in completed if r.get("conclusion") == "success"]
    pass_rate    = round(len(successes) / len(completed) * 100, 1)

    durations = []
    for r in completed:
        start = datetime.strptime(r["created_at"], "%Y-%m-%dT%H:%M:%SZ")
        end   = datetime.strptime(r["updated_at"], "%Y-%m-%dT%H:%M:%SZ")
        dur   = (end - start).total_seconds()
        if 0 < dur < 7200:
            durations.append(dur)
    avg_duration = round(sum(durations) / len(durations)) if durations else None

    headline = {
        "pass_rate":            pass_rate,
        "avg_duration_seconds": avg_duration,
        "last_run_at":          completed[0]["created_at"] if completed else None,
        "last_status":          completed[0].get("conclusion") or completed[0].get("status") if completed else None,
    }

    # full run list for runs/{repo}.json
    run_list = []
    for r in completed:
        start = datetime.strptime(r["created_at"], "%Y-%m-%dT%H:%M:%SZ")
        end   = datetime.strptime(r["updated_at"], "%Y-%m-%dT%H:%M:%SZ")
        run_list.append({
            "id":               r["id"],
            "name":             r.get("name", ""),
            "branch":           r.get("head_branch", ""),
            "conclusion":       r.get("conclusion"),
            "duration_seconds": round((end - start).total_seconds()),
            "created_at":       r["created_at"],
            "actor":            r["actor"]["login"] if r.get("actor") else None,
        })

    return headline, run_list


def get_open_prs(repo_name):
    """Fetch open PRs only. Returns open count + full PR list for prs/{repo}.json."""
    data = gh_get(f"{BASE}/repos/{ORG}/{repo_name}/pulls", {
        "state": "open", "per_page": 100
    })
    if not data:
        return 0, []

    now    = datetime.now(timezone.utc)
    pr_list = []
    for pr in data:
        created_at = datetime.fromisoformat(pr["created_at"].replace("Z", "+00:00"))
        days_open  = (now - created_at).days
        pr_list.append({
            "number":     pr["number"],
            "title":      pr["title"],
            "author":     pr["user"]["login"] if pr.get("user") else None,
            "base_branch": pr.get("base", {}).get("ref"),
            "pr_branch":   pr.get("head", {}).get("ref"),
            "created_at": pr["created_at"],
            "url":        pr["html_url"],
            "days_open":  days_open,
        })

    return len(pr_list), pr_list


def get_merged_prs_total(repo_name):
    """Fetch total merged PR count for a repo (all-time, not date-range bound)."""
    data = gh_get(f"{BASE}/search/issues", {
        "q": f"repo:{ORG}/{repo_name} is:pr is:merged",
        "per_page": 1,
    })
    if not data:
        return 0

    return int(data.get("total_count") or 0)


# ── status label ────────────────────────────────────────────────────────────

def get_status(pass_rate):
    if pass_rate is None: return "unknown"
    if pass_rate >= 50:   return "passing"
    return "degraded"


# ── write helpers ────────────────────────────────────────────────────────────

def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


# ── main ────────────────────────────────────────────────────────────────────

def main():
    print(f"Fetching CI metrics for org: {ORG}\n")

    repo_to_group = load_groups()
    repos         = get_repos(repo_to_group.keys())
    print(f"Found {len(repos)} grouped repos\n")

    repo_metrics = []

    for i, repo in enumerate(repos):
        name = repo["name"]
        print(f"[{i + 1}/{len(repos)}] {name}")

        headline, run_list = get_workflow_runs(name)
        open_count, pr_list = get_open_prs(name)
        merged_prs_total = get_merged_prs_total(name)

        pass_rate = headline["pass_rate"] if headline else None

        # write runs/{repo}.json
        write_json(f"{OUTPUT_DIR}/runs/{name}.json", {
            "repo":       name,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "runs":       run_list,
        })

        # write prs/{repo}.json
        write_json(f"{OUTPUT_DIR}/prs/{name}.json", {
            "repo":       name,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "open_prs":   pr_list,
            "merged_prs_total": merged_prs_total,
        })

        repo_metrics.append({
            "name":                 name,
            "full_name":            repo["full_name"],
            "group":                repo_to_group.get(name),
            "status":               get_status(pass_rate),
            "pass_rate":            pass_rate,
            "avg_duration_seconds": headline["avg_duration_seconds"] if headline else None,
            "last_run_at":          headline["last_run_at"]          if headline else None,
            "open_prs":             open_count,
            "merged_prs_total":     merged_prs_total,
        })

        time.sleep(0.3)

    # org-wide summary for index.json
    with_rate = [r for r in repo_metrics if r["pass_rate"] is not None]
    durs      = [r["avg_duration_seconds"] for r in repo_metrics if r["avg_duration_seconds"]]

    index = {
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "org":       ORG,
        "summary": {
            "total_repos":          len(repo_metrics),
            "pass_rate":            round(sum(r["pass_rate"] for r in with_rate) / len(with_rate), 1) if with_rate else 0,
            "avg_duration_seconds": round(sum(durs) / len(durs)) if durs else 0,
            "open_prs":             sum(r["open_prs"] for r in repo_metrics),
            "passing":              sum(1 for r in repo_metrics if r["status"] == "passing"),
            "degraded":             sum(1 for r in repo_metrics if r["status"] == "degraded"),
            "failing":              sum(1 for r in repo_metrics if r["status"] == "failing"),
            "unknown":              sum(1 for r in repo_metrics if r["status"] == "unknown"),
        },
        "repos": repo_metrics,
    }

    write_json(f"{OUTPUT_DIR}/index.json", index)

    print(f"\nDone.")
    print(f"  index.json → {OUTPUT_DIR}/index.json")
    print(f"  runs/      → {OUTPUT_DIR}/runs/  ({len(repo_metrics)} files)")
    print(f"  prs/       → {OUTPUT_DIR}/prs/   ({len(repo_metrics)} files)")
    print(f"\n  Passing  : {index['summary']['passing']}")
    print(f"  Degraded : {index['summary']['degraded']}")
    print(f"  Failing  : {index['summary']['failing']}")
    print(f"  Unknown  : {index['summary']['unknown']}")


if __name__ == "__main__":
    main()
