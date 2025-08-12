// Background service worker for Cookie Selector Extension
// Handles extension lifecycle, installation, updates, and error management


chrome.runtime.onInstalled.addListener((details) => {
  try {
    console.log("Cookie Selector extension event:", details.reason);

    switch (details.reason) {
      case "install":
        console.log("Extension installed for the first time");
        handleFirstInstall();
        break;
      case "update":
        console.log("Extension updated from version:", details.previousVersion);
        handleExtensionUpdate(details.previousVersion);
        break;
      case "chrome_update":
        console.log("Chrome browser updated");
        handleChromeUpdate();
        break;
      default:
        console.log("Unknown installation reason:", details.reason);
    }
  } catch (error) {
    console.error("Error in onInstalled handler:", error);
    handleServiceWorkerError("onInstalled", error);
  }
});


function handleFirstInstall() {
  try {
    // Set up initial extension state
    console.log("Setting up Cookie Selector extension for first use");

    // Could be used for future analytics or user onboarding
    // For now, just log successful installation
    console.log("Cookie Selector extension ready to use");
  } catch (error) {
    console.error("Error during first install setup:", error);
    handleServiceWorkerError("firstInstall", error);
  }
}


function handleExtensionUpdate(previousVersion) {
  try {
    console.log(
      `Extension updated from ${previousVersion} to ${
        chrome.runtime.getManifest().version
      }`
    );

    // Handle any migration logic for future updates
    // For now, just log the update
    console.log("Extension update completed successfully");
  } catch (error) {
    console.error("Error during extension update:", error);
    handleServiceWorkerError("extensionUpdate", error);
  }
}


function handleChromeUpdate() {
  try {
    console.log("Chrome browser updated, extension reloaded");

    // Verify API compatibility after Chrome updates
    verifyAPICompatibility();
  } catch (error) {
    console.error("Error during Chrome update handling:", error);
    handleServiceWorkerError("chromeUpdate", error);
  }
}


chrome.runtime.onStartup.addListener(() => {
  try {
    console.log("Cookie Selector service worker started");

    // Verify that required APIs are available
    verifyAPICompatibility();
  } catch (error) {
    console.error("Error during service worker startup:", error);
    handleServiceWorkerError("startup", error);
  }
});


function verifyAPICompatibility() {
  try {
    // Check if required APIs are available
    if (!chrome.cookies) {
      throw new Error("Chrome cookies API not available");
    }

    if (!chrome.tabs) {
      throw new Error("Chrome tabs API not available");
    }

    if (!chrome.runtime) {
      throw new Error("Chrome runtime API not available");
    }

    console.log("All required Chrome APIs are available");
    return true;
  } catch (error) {
    console.error("API compatibility check failed:", error);
    handleServiceWorkerError("apiCompatibility", error);
    return false;
  }
}


function handleServiceWorkerError(context, error) {
  const errorInfo = {
    context: context,
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest().version,
  };

  // Log detailed error information
  console.error("Service Worker Error:", errorInfo);

  // In a production extension, you might want to:
  // - Send error reports to a logging service
  // - Store error information for debugging
  // - Notify the user if the error affects functionality

  // For now, we'll just ensure the error is properly logged
  try {
    // Attempt to store error information locally for debugging
    // This is a basic implementation - in production you might use chrome.storage
    console.warn(`Service worker error in ${context}:`, error.message);
  } catch (storageError) {
    console.error("Failed to store error information:", storageError);
  }
}


chrome.runtime.onSuspend.addListener(() => {
  try {
    console.log("Cookie Selector service worker suspending");

    // Clean up any resources before suspension
    // For this extension, we don't have persistent connections to clean up
    console.log("Service worker cleanup completed");
  } catch (error) {
    console.error("Error during service worker suspension:", error);
    handleServiceWorkerError("suspend", error);
  }
});


chrome.runtime.onSuspendCanceled.addListener(() => {
  try {
    console.log("Cookie Selector service worker suspension canceled");

    // Re-initialize if needed
    verifyAPICompatibility();
  } catch (error) {
    console.error("Error during suspension cancellation:", error);
    handleServiceWorkerError("suspendCanceled", error);
  }
});


self.addEventListener("error", (event) => {
  console.error("Unhandled error in service worker:", event.error);
  handleServiceWorkerError("unhandled", event.error);
});


self.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection in service worker:", event.reason);
  handleServiceWorkerError("unhandledPromise", new Error(event.reason));

  // Prevent the default handling (which would log to console)
  event.preventDefault();
});

// Log that the service worker script has loaded
console.log("Cookie Selector background service worker loaded successfully");

