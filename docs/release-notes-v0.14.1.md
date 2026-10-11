# IAM Range v0.14.1

- Treat explicit code requests as direct answers, request runnable scripts, and allow longer local AI generation for code.
- Stop replacing failed script requests with unrelated documentation excerpts. Supply a reviewed CSV onboarding example for supported PowerShell requests, including the requested sample employee count and copyable code blocks.
- Replace known invalid Active Directory onboarding cmdlets with the reviewed reference script. Verify the 20-employee example by executing it against the simulated directory.
- Allow general HTTP/HTTPS websites in the desktop app browser on the main and remote desktops. Keep remote pages isolated and reject local files, executable URL schemes and embedded credentials.
- Replace known refused-frame pages in the web preview with a clear Open website action. Sites that prohibit embedding require the desktop app to display inside the VM browser window.
