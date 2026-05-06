from dotenv import load_dotenv
import requests
import os
from datetime import datetime
load_dotenv()

GH_TOKEN = os.getenv("GITHUB_TOKEN")

HEADERS = {
    "Authorization": f"Bearer {GH_TOKEN}",
    "Accept": "application/vnd.github+json"
}

ORG = "CIDashboard"
BASE_REPO_URL = f"https://api.github.com/orgs/{ORG}/repos"


def get_repos():
    repos = []
    page = 1

    while True:
        params = {"per_page": 100, "page": page}
        response = requests.get(BASE_REPO_URL, headers=HEADERS, params=params)

        if response.status_code != 200:
            print("Error:", response.status_code, response.text)
            break

        data = response.json()
        if not data:
            break

        for repo in data:
            repos.append(repo["name"])

        page += 1

    return repos


def get_workflow_runs(repo):
    url = f"https://api.github.com/repos/{ORG}/{repo}/actions/runs"

    params = {
        "per_page": 50
    }

    response = requests.get(url, headers=HEADERS, params=params)

    if response.status_code != 200:
        print(f"Error in {repo}:", response.status_code)
        return []

    data = response.json()
    runs=data.get("workflow_runs", [])
    for run in runs:
            start = datetime.strptime(run["created_at"], "%Y-%m-%dT%H:%M:%SZ")
            end = datetime.strptime(run["updated_at"], "%Y-%m-%dT%H:%M:%SZ")
            duration = (end - start).total_seconds()
            print("Run Name:",
                run["name"],
                "Run Status:",
                run["status"],
                "Result:",
                run["conclusion"],
                "Branch:",
                run["head_branch"],
                "Ran By:",
                run["actor"]["login"],
                "Time Taken:",
                duration,"seconds"

            )

def get_prs(repo):
    url = f"https://api.github.com/repos/{ORG}/{repo}/pulls"

    params = {
        "per_page": 50
    }

    response = requests.get(url, headers=HEADERS, params=params)

    if response.status_code != 200:
        print(f"Error in {repo}:", response.status_code)
        return []

    data = response.json()
    prs_list=data.get("prs_list", [])
    for pr in prs_list:

            print("PR Number:",
                pr["number"],
                "PR Title:",
                pr["title"],
                "url:",
                pr["url"],
            )

def main():
    repos = get_repos()

    for repo in repos:
        print(f"\nRepo: {repo}")
        get_workflow_runs(repo)
        # runs = get_workflow_runs(repo)

        


if __name__ == "__main__":
    main()
