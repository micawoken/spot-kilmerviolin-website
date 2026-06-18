---
title: GitHub, Version Control, and Automated Deployment
description: Explains how source code version control is managed and where the source code lives
author: Michael Wong
---

## Overview

The website's source code is maintained at GitHub. GitHub is used to manage projects using the Git version control system. This version control system allows all changes to be tracked: you can see what changed, who changed it, and when the change was made.

This doc outlines how Git works, how GitHub works, and you will use these systems to maintain the website.

## Video Guide

(YouTube embed)

## What is git?

Git is a version control system: it tracks how a project's files change over time. It records changes after every save event, which is called a commit. Commits are run whenever a project contributor believes enough changes have been made for one, and Git will track exactly what changes happened since the last save. This allows you to see what changed over time and, if needed, to undo any changes you made.

Git allows for managing multiple branches, or separate version histories, of a project. Changes made to one version do not propagate to the rest unless you push the changes there.

## What is GitHub?

GitHub is a service that hosts projects using Git. GitHub calls these projects repositories, or repos. It hosts the projects by storing a project's files, storing its history, and providing tools for contributors to make, review, and discuss changes.

### Version control

Because every change is a commit with a full history, GitHub provides a reliable record of the
project, documenting who changed what and when. Git commit hashes (a unique ID associated with each commit) are written in a way that enforces the order that changes occurred.

### Website building through Actions CI/CD

GitHub provides a service called Actions that allows us to deploy our website. Actions is used to provide a continuous integration/continuous deployment pipeline: when a change is made to a target branch, Actions will build and publish the website.

## How do I use GitHub to edit the website?

You can add a Markdown file (`.md`) to the project repository (most likely in the src/pages folder) using the GitHub.com web interface. When you upload or create a new file, GitHub will prompt you to create a commit.

### The three branches

A **branch** is a distinct version history. This project uses three to store the different versions for development, testing, and publication:

#### development

This is where you will upload or add your new pages. The development branch stores the newest changes and the changes that have been proposed.

#### staging

This is where changes will be tested. The staging branch stores proposed changes and allows you to preview how they look.

#### main

This is the current version of the website. The main branch stores the current configuration of the website.

### Adding a file

To add a new file (for example, a new content page), you place it in the correct folder in the
repository — see [Adding Website Pages](/admin/docs/adding-pages) and the
[Codebase doc](/admin/docs/codebase) for where things go. In the GitHub web interface you can use the
"Add file" button; on your own computer you would create the file and then tell git to track it with
`git add`.

### Committing your change

A **commit** groups your changes together with a short message describing what you did (for example,
"Add welcome page"). Write the message so that someone reading the history later understands the change
at a glance. Each commit becomes a permanent point in the project's history that you can return to.

### Creating a pull request

A **pull request** (PR) is a proposal to merge your changes from one branch into another (for
instance, from `development` into `staging`). Opening a PR on GitHub shows exactly what you changed and
lets others review and comment before anything is merged. This is how changes are checked before they
move closer to publication.

### Approving a pull request

Once a pull request has been reviewed and looks good, a maintainer **approves** and **merges** it,
which brings the changes into the target branch. If that branch is `staging` or `main`, the CI/CD
automation then builds and deploys the site automatically.