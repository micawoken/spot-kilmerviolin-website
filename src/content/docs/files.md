---
title: File Management
description: Upload, manage, and reference image files stored in the file store
author: Michael Wong
---

## Overview

Database records can contain images to show on the website. You use File Management to add, update, and delete these files.

The following actions are available from the [File Management menu](/admin/files):

- **Add new file** - upload a new file
- **View file info** - view file information and preview
- **Replace existing file** - replace a file
- **Delete file** - permanently delete a file
- **List files** - list all files

## File Uploads
Only images may be uploaded to the system (enforced by the server). When you upload an image, you must set alt-text: it describes what the image is for individuals with vision impairments or screen readers. Alt-text is 256 characters max.

When images are uploaded, they are assigned a file key. You use the file key to look up a file when you want to set it onto a database record.

### Storage location
Images are stored:
1. In the cloud, on Cloudflare R2, and
2. In the project, in src/files/*.

For cloud storage: you can store up to 9 GB of images. When you upload the images, they will be made public immediately. **Do not upload personal images of any type - they are not secure and may be leaked.**

#### Alt text for src/files/*
Alt text should be set using {image_name}.txt.

## Create/Read/Update/Delete Files
To do these operations, access the relevant link.

## Use Uploaded Files
To set a file onto a database record, enter the file key into the image field. You can use the built-in search function to look it up.

### Contributor records
If you are not an administrator, and you want to update the image for your account, **you can only use a photo you upload.** This is to prevent anyone else from using your profile photo on their account. This restriction does not apply to composers or compositions.

(Non-administrators cannot edit other contributors, so they cannot modify their images.)

## Questions
Any questions? Contact [contact@michaelwongmusic.com](mailto:contact@michaelwongmusic.com).