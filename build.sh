#!/bin/bash


# Usage function
usage() {
  echo "Usage: $0"
  exit 1
}

##------ Check for uncommitted changes
if git diff-index --quiet HEAD --; then
  echo "No uncommitted changes. Continuing..."
else
  echo "Uncommitted changes detected. Stopping the script."
  exit 1
fi

# Get current branch name
current_branch=$(git symbolic-ref --short HEAD)

# Merge current branch into master
if [ "$current_branch" != "master" ]; then
  # Switch to master branch
  git checkout master
  git merge -

  # Check for merge conflicts
  if [ $? -ne 0 ]; then
    echo "Merge conflicts detected. Please resolve them and then run the script again."
    exit 1
  fi
else
  echo "Already on master branch. No merge needed."
fi

# builds
yarn build

# Update version and capture the new version
new_version=$(node update-version.js)

# Commit with the new version number
git add .
git commit -m "$new_version"
git push origin --all
git tag -a "$new_version" -m "$new_version"
git push origin "$new_version"


# Switch back to the previous branch
git checkout -

# shows new version
echo "$new_version"
