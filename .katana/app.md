# ayd - aio youtube downloader utilizing yt-dlp

## General

- ayd is ui app using aio framework (dep/aio)
- ayd is electron app
- app uses yt-dlp (located in dep/ytdlp/ direrctory)
- app provides button to update yt-dlp `yt-dlp --update`
- app takes youtube link and shows list of downloadable video and audio formats
- app preselect most suitable format (ie. format where is best quality video and
  audio)
- app will also marks best option for only video and only audio for that
  parcicular video
- app has "Download" button which will download selected media into
  ~/.ayd/downloads (default download directory)
- app shows input where user can change target directory, there is also button
  to browse via filesystem (native dialog) to select another directory
- when media is downloaded, there is progress bar showing overall status of the
  download
- app reports about current status like "Ready", "Downloading", "Finished", etc.
- app ui is compact, intuitive, fresh looking, aesthetic, single color, icons
  are pro-looking svg all same size and colors
