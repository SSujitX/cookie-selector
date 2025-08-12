// Cookie Selector Extension - Popup Script
// Cookie data structure for UI state management
class CookieData {
  constructor(cookie) {
    this.name = cookie.name;
    this.value = cookie.value;
    this.domain = cookie.domain;
    this.path = cookie.path;
    this.secure = cookie.secure;
    this.httpOnly = cookie.httpOnly;
    this.selected = false; // UI state for selection
  }
}
// Global state management
let currentDomain = "";
let cookies = [];
let filteredCookies = []; // Filtered cookies for search functionality
let selectedCount = 0;
let searchTerm = "";
let isLoading = false;
let retryCount = 0;
const MAX_RETRY_ATTEMPTS = 3;
// Performance optimization variables
let searchDebounceTimer = null;
let renderAnimationFrame = null;
let virtualScrollOffset = 0;
const VIRTUAL_SCROLL_ITEM_HEIGHT = 60; // Approximate height of each cookie item
const VIRTUAL_SCROLL_BUFFER = 5; // Number of items to render outside visible area
let eventListeners = new Map(); // Track event listeners for cleanup
async function getCurrentTab() {
  try {
    // Check if tabs API is available
    if (!chrome.tabs) {
      throw new Error(
        "PERMISSION_ERROR: Chrome tabs API not available. Please check extension permissions."
      );
    }
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) {
      throw new Error(
        "NO_TAB: No active tab found. Please ensure you have an active browser tab."
      );
    }
    if (!tab.url) {
      throw new Error(
        "NO_URL: Unable to access tab URL. This may be a restricted page."
      );
    }
    // Check for restricted URLs
    if (
      tab.url.startsWith("chrome://") ||
      tab.url.startsWith("chrome-extension://") ||
      tab.url.startsWith("moz-extension://") ||
      tab.url.startsWith("about:") ||
      tab.url.startsWith("edge://") ||
      tab.url.startsWith("opera://") ||
      tab.url.startsWith("brave://")
    ) {
      throw new Error(
        "RESTRICTED_URL: Cannot access cookies on browser internal pages."
      );
    }
    return tab;
  } catch (error) {
    console.error("Error getting current tab:", error);
    // Re-throw with enhanced error information
    if (
      error.message.includes("PERMISSION_ERROR") ||
      error.message.includes("NO_TAB") ||
      error.message.includes("NO_URL") ||
      error.message.includes("RESTRICTED_URL")
    ) {
      throw error;
    }
    throw new Error(
      `TAB_ACCESS_ERROR: Unable to access current tab. ${error.message}`
    );
  }
}
async function getCookiesForDomain(domain) {
  try {
    // Check if we have the necessary permissions
    if (!chrome.cookies) {
      throw new Error(
        "PERMISSION_ERROR: Cookie API not available. Please check extension permissions."
      );
    }
    // Validate domain parameter
    if (!domain || typeof domain !== "string") {
      throw new Error("INVALID_DOMAIN: Invalid domain parameter provided.");
    }
    // Show progress for cookie retrieval
    updateLoadingMessage("Retrieving cookies...");
    // Get all cookies for the domain with timeout
    // Include parent domain and subdomain variations
    const domainParts = domain.split(".");
    const cookiePromises = [
      chrome.cookies.getAll({ domain: domain }),
      chrome.cookies.getAll({ domain: "." + domain }),
    ];
    console.log(`Querying cookies for domain: ${domain}`);
    console.log(`Querying cookies for domain: .${domain}`);
    // Add parent domain if current domain is a subdomain
    if (domainParts.length > 2) {
      const parentDomain = domainParts.slice(1).join(".");
      console.log(`Querying cookies for parent domain: ${parentDomain}`);
      console.log(`Querying cookies for parent domain: .${parentDomain}`);
      cookiePromises.push(
        chrome.cookies.getAll({ domain: parentDomain }),
        chrome.cookies.getAll({ domain: "." + parentDomain })
      );
    }
    // Also try to get all cookies for the current URL without domain restriction
    // This will get cookies that might be set for the specific path or other variations
    try {
      const tab = await getCurrentTab();
      if (tab && tab.url) {
        console.log(`Querying cookies for URL: ${tab.url}`);
        cookiePromises.push(chrome.cookies.getAll({ url: tab.url }));
      }
    } catch (error) {
      console.warn(
        "Could not get tab URL for additional cookie retrieval:",
        error
      );
    }
    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error("TIMEOUT: Cookie retrieval timed out after 10 seconds")
          ),
        10000
      );
    });
    const results = await Promise.race([
      Promise.all(cookiePromises),
      timeoutPromise,
    ]);
    // Log the results from each query for debugging
    results.forEach((cookieArray, index) => {
      console.log(`Query ${index + 1} returned ${cookieArray.length} cookies`);
    });
    // Combine all cookie arrays from different domain queries
    const allCookies = results.flat();
    console.log(`Total cookies before deduplication: ${allCookies.length}`);
    // Deduplicate cookies based on name, domain, and path
    const uniqueCookies = allCookies.filter(
      (cookie, index, self) =>
        index ===
        self.findIndex(
          (c) =>
            c.name === cookie.name &&
            c.domain === cookie.domain &&
            c.path === cookie.path
        )
    );
    console.log(`Unique cookies after deduplication: ${uniqueCookies.length}`);
    // Convert to our cookie data structure
    const cookieDataArray = uniqueCookies.map(
      (cookie) => new CookieData(cookie)
    );
    console.log(
      `Final cookie data array: ${cookieDataArray.length} cookies for domain: ${domain}`
    );
    // Log the domains of all retrieved cookies for debugging
    const cookieDomains = [...new Set(uniqueCookies.map((c) => c.domain))];
    console.log(`Cookies found for domains: ${cookieDomains.join(", ")}`);
    return cookieDataArray;
  } catch (error) {
    console.error("Error getting cookies for domain:", error);
    // Handle specific error cases with detailed messages
    if (error.message.includes("PERMISSION_ERROR")) {
      throw error;
    } else if (error.message.includes("TIMEOUT")) {
      throw error;
    } else if (error.message.includes("INVALID_DOMAIN")) {
      throw error;
    } else if (
      error.message.includes("permissions") ||
      error.message.includes("denied")
    ) {
      throw new Error(
        "PERMISSION_ERROR: Cookie access denied. Please grant cookie permissions to this extension in Chrome settings."
      );
    } else if (
      error.message.includes("API") ||
      error.message.includes("undefined")
    ) {
      throw new Error(
        "API_ERROR: Cookie API unavailable. Please ensure you are using a supported Chrome version."
      );
    } else if (
      error.message.includes("network") ||
      error.message.includes("connection")
    ) {
      throw new Error(
        "NETWORK_ERROR: Network error while retrieving cookies. Please check your connection and try again."
      );
    } else {
      throw new Error(
        `COOKIE_ERROR: Unable to retrieve cookies: ${error.message}`
      );
    }
  }
}
function extractDomain(url) {
  try {
    if (!url || typeof url !== "string") {
      throw new Error(
        "INVALID_URL: URL parameter is required and must be a string"
      );
    }
    // Handle special cases
    if (
      url.startsWith("chrome://") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("moz-extension://") ||
      url.startsWith("about:") ||
      url.startsWith("edge://") ||
      url.startsWith("opera://") ||
      url.startsWith("brave://")
    ) {
      throw new Error(
        "RESTRICTED_URL: Cannot extract domain from browser internal pages"
      );
    }
    // Handle data URLs
    if (url.startsWith("data:")) {
      throw new Error("DATA_URL: Cannot extract domain from data URLs");
    }
    // Handle file URLs
    if (url.startsWith("file://")) {
      throw new Error("FILE_URL: Cannot extract domain from local file URLs");
    }
    const urlObj = new URL(url);
    if (!urlObj.hostname) {
      throw new Error("NO_HOSTNAME: URL does not contain a valid hostname");
    }
    // Remove 'www.' prefix for consistency
    let domain = urlObj.hostname;
    if (domain.startsWith("www.")) {
      domain = domain.substring(4);
    }
    return domain;
  } catch (error) {
    console.error("Error extracting domain from URL:", error);
    // Re-throw with enhanced error information
    if (
      error.message.includes("INVALID_URL") ||
      error.message.includes("RESTRICTED_URL") ||
      error.message.includes("DATA_URL") ||
      error.message.includes("FILE_URL") ||
      error.message.includes("NO_HOSTNAME")
    ) {
      throw error;
    }
    throw new Error(
      `DOMAIN_EXTRACTION_ERROR: Invalid URL format - ${error.message}`
    );
  }
}
async function initializePopup() {
  if (isLoading) {
    console.log("Initialization already in progress");
    return;
  }
  isLoading = true;
  const loadingState = document.getElementById("loading-state");
  const errorState = document.getElementById("error-state");
  try {
    cleanupEventListeners();
    hideErrorState();
    showLoadingState("Initializing...");
    updateLoadingMessage("Accessing current tab...");
    const currentTab = await getCurrentTab();
    currentDomain = extractDomain(currentTab.url);
    const domainElement = document.getElementById("current-domain");
    if (domainElement) {
      domainElement.textContent = currentDomain;
    }
    console.log("Current domain:", currentDomain);
    updateLoadingMessage("Loading cookies...");
    cookies = await getCookiesForDomain(currentDomain);
    updateLoadingMessage("Setting up interface...");
    initializeSelectionControls();
    initializeSearchControlsWithDebounce();
    initializeExportControls();
    initializeKeyboardNavigation();
    filteredCookies = [...cookies];
    hideLoadingState();
    renderCookieListOptimized(filteredCookies);
    retryCount = 0;
    if (cookies.length === 0) {
      console.log("No cookies found for domain:", currentDomain);
    } else {
      console.log(`Found ${cookies.length} cookies for domain:`, currentDomain);
    }
  } catch (error) {
    if (error.message.includes("RESTRICTED_URL")) {
      console.log("Restricted URL detected:", error.message);
      const domainElement = document.getElementById("current-domain");
      if (domainElement) {
        domainElement.textContent = "Restricted Page";
      }
    } else {
      console.error("Error initializing popup:", error);
    }
    hideLoadingState();
    displayError(error.message, error);
  } finally {
    isLoading = false;
  }
}
function displayError(message, error = null) {
  const errorElement = document.getElementById("error-state");
  const errorMessageElement = document.getElementById("error-message");
  const retryButton = document.getElementById("retry-button");
  const permissionsButton = document.getElementById("permissions-button");
  if (!errorElement || !errorMessageElement) {
    console.error("Error display elements not found");
    return;
  }
  // Determine error type and customize message
  let displayMessage = message;
  let showPermissionsButton = false;
  let showRetryButton = true;
  if (error && error.message) {
    if (error.message.includes("PERMISSION_ERROR")) {
      displayMessage =
        "This extension needs permission to access cookies. Please grant cookie permissions in Chrome settings.";
      showPermissionsButton = true;
    } else if (error.message.includes("RESTRICTED_URL")) {
      displayMessage =
        "🚫 This page is restricted\n\nCookies cannot be accessed on browser internal pages.\nPlease navigate to a regular website to manage cookies.";
      showRetryButton = false;
    } else if (error.message.includes("TIMEOUT")) {
      displayMessage =
        "Request timed out. Please check your connection and try again.";
    } else if (error.message.includes("API_ERROR")) {
      displayMessage =
        "Browser API unavailable. Please update Chrome or try restarting the browser.";
    } else if (error.message.includes("NETWORK_ERROR")) {
      displayMessage =
        "Network error occurred. Please check your connection and try again.";
    }
  }
  // Update error message
  errorMessageElement.textContent = displayMessage;
  // Configure retry button
  if (retryButton) {
    retryButton.style.display = showRetryButton ? "inline-block" : "none";
    if (showRetryButton) {
      // Update retry button text based on retry count
      if (retryCount >= MAX_RETRY_ATTEMPTS) {
        retryButton.textContent = "Max Retries Reached";
        retryButton.disabled = true;
      } else {
        retryButton.textContent =
          retryCount > 0
            ? `Retry (${retryCount}/${MAX_RETRY_ATTEMPTS})`
            : "Retry";
        retryButton.disabled = false;
      }
      // Remove existing event listeners and add new one
      const newRetryButton = retryButton.cloneNode(true);
      retryButton.parentNode.replaceChild(newRetryButton, retryButton);
      newRetryButton.addEventListener("click", handleRetry);
    }
  }
  // Configure permissions button
  if (permissionsButton) {
    permissionsButton.style.display = showPermissionsButton
      ? "inline-block"
      : "none";
    if (showPermissionsButton) {
      // Remove existing event listeners and add new one
      const newPermissionsButton = permissionsButton.cloneNode(true);
      permissionsButton.parentNode.replaceChild(
        newPermissionsButton,
        permissionsButton
      );
      newPermissionsButton.addEventListener("click", handlePermissionsRequest);
    }
  }
  // Show error state
  errorElement.style.display = "flex";
  console.error("Displayed error to user:", displayMessage);
}
function showLoadingState(message = "Loading...") {
  const loadingState = document.getElementById("loading-state");
  if (loadingState) {
    loadingState.style.display = "flex";
    updateLoadingMessage(message);
  }
}
function hideLoadingState() {
  const loadingState = document.getElementById("loading-state");
  if (loadingState) {
    loadingState.style.display = "none";
  }
}
function updateLoadingMessage(message) {
  const loadingMessage = document.getElementById("loading-message");
  if (loadingMessage) {
    loadingMessage.textContent = message;
  }
}
function hideErrorState() {
  const errorState = document.getElementById("error-state");
  if (errorState) {
    errorState.style.display = "none";
  }
}
async function handleRetry() {
  if (retryCount >= MAX_RETRY_ATTEMPTS) {
    console.log("Maximum retry attempts reached");
    return;
  }
  retryCount++;
  console.log(`Retry attempt ${retryCount}/${MAX_RETRY_ATTEMPTS}`);
  // Add exponential backoff delay
  const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
  if (delay > 0) {
    showLoadingState(`Retrying in ${Math.ceil(delay / 1000)} seconds...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  // Retry initialization
  await initializePopup();
}
async function handlePermissionsRequest() {
  try {
    showLoadingState("Requesting permissions...");
    // Request permissions using Chrome permissions API
    if (chrome.permissions) {
      const granted = await chrome.permissions.request({
        permissions: ["cookies"],
        origins: ["<all_urls>"],
      });
      if (granted) {
        console.log("Permissions granted, retrying initialization");
        retryCount = 0; // Reset retry count on permission grant
        await initializePopup();
      } else {
        hideLoadingState();
        displayError(
          "Permissions were not granted. Please enable cookie permissions manually in Chrome settings."
        );
      }
    } else {
      // Fallback: open Chrome settings
      hideLoadingState();
      if (chrome.tabs) {
        chrome.tabs.create({ url: "chrome://extensions/" });
      }
      displayError(
        "Please grant cookie permissions manually in Chrome extensions settings."
      );
    }
  } catch (error) {
    console.error("Error requesting permissions:", error);
    hideLoadingState();
    displayError(
      "Failed to request permissions. Please enable them manually in Chrome settings."
    );
  }
}
function showProgress(progress) {
  let progressIndicator = document.getElementById("progress-indicator");
  if (!progressIndicator) {
    progressIndicator = document.createElement("div");
    progressIndicator.id = "progress-indicator";
    progressIndicator.className = "progress-indicator";
    progressIndicator.innerHTML = '<div class="progress-bar"></div>';
    document.body.appendChild(progressIndicator);
  }
  const progressBar = progressIndicator.querySelector(".progress-bar");
  if (progressBar) {
    progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
  }
  progressIndicator.style.display = "block";
}
function hideProgress() {
  const progressIndicator = document.getElementById("progress-indicator");
  if (progressIndicator) {
    progressIndicator.style.display = "none";
  }
}
window.addEventListener("error", (event) => {
  console.error("Unhandled error in popup:", event.error);
  // Don't show error to user for minor issues, but log them
  if (event.error && event.error.message) {
    // Only show critical errors to user
    if (
      event.error.message.includes("CRITICAL") ||
      event.error.message.includes("FATAL")
    ) {
      displayError("A critical error occurred. Please refresh the extension.");
    }
  }
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection in popup:", event.reason);
  // Prevent default handling for non-critical errors
  if (event.reason && typeof event.reason === "string") {
    if (!event.reason.includes("CRITICAL") && !event.reason.includes("FATAL")) {
      event.preventDefault();
    }
  }
});
function safeGetElement(elementId, elementName = "element") {
  const element = document.getElementById(elementId);
  if (!element) {
    console.warn(`${elementName} not found: ${elementId}`);
  }
  return element;
}
function safeAddEventListener(element, event, handler, context = "unknown") {
  if (!element) {
    console.warn(`Cannot add ${event} listener: element is null (${context})`);
    return;
  }
  try {
    const wrappedHandler = (e) => {
      try {
        handler(e);
      } catch (error) {
        console.error(`Error in ${event} handler (${context}):`, error);
      }
    };
    element.addEventListener(event, wrappedHandler);
    // Track event listener for cleanup
    const key = `${context}-${event}`;
    if (!eventListeners.has(key)) {
      eventListeners.set(key, []);
    }
    eventListeners.get(key).push({
      element,
      event,
      handler: wrappedHandler,
    });
  } catch (error) {
    console.error(`Failed to add ${event} listener (${context}):`, error);
  }
}
function cleanupEventListeners() {
  eventListeners.forEach((listeners, key) => {
    listeners.forEach(({ element, event, handler }) => {
      try {
        element.removeEventListener(event, handler);
      } catch (error) {
        console.warn(`Failed to remove event listener for ${key}:`, error);
      }
    });
  });
  eventListeners.clear();
}
function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
}
function focusNextCookieItem(currentItem) {
  const cookieItems = document.querySelectorAll(".cookie-item");
  const currentIndex = Array.from(cookieItems).indexOf(currentItem);
  if (currentIndex < cookieItems.length - 1) {
    cookieItems[currentIndex + 1].focus();
  } else {
    // Wrap to first item
    cookieItems[0]?.focus();
  }
}
function focusPreviousCookieItem(currentItem) {
  const cookieItems = document.querySelectorAll(".cookie-item");
  const currentIndex = Array.from(cookieItems).indexOf(currentItem);
  if (currentIndex > 0) {
    cookieItems[currentIndex - 1].focus();
  } else {
    // Wrap to last item
    cookieItems[cookieItems.length - 1]?.focus();
  }
}
function focusFirstCookieItem() {
  const firstItem = document.querySelector(".cookie-item");
  firstItem?.focus();
}
function focusLastCookieItem() {
  const cookieItems = document.querySelectorAll(".cookie-item");
  const lastItem = cookieItems[cookieItems.length - 1];
  lastItem?.focus();
}
function initializeKeyboardNavigation() {
  // Add global keyboard shortcuts
  document.addEventListener("keydown", (event) => {
    // Handle global shortcuts
    if (event.ctrlKey || event.metaKey) {
      switch (event.key) {
        case "a":
          event.preventDefault();
          handleSelectAll();
          break;
        case "d":
          event.preventDefault();
          handleDeselectAll();
          break;
        case "e":
          event.preventDefault();
          const exportBtn = document.getElementById("export-btn");
          if (exportBtn && !exportBtn.disabled) {
            exportBtn.click();
          }
          break;
        case "f":
          event.preventDefault();
          const searchInput = document.getElementById("search-input");
          searchInput?.focus();
          break;
      }
    }
    // Handle escape key to clear search
    if (event.key === "Escape") {
      const searchInput = document.getElementById("search-input");
      if (searchInput && searchInput.value) {
        searchInput.value = "";
        filterCookies("");
        searchInput.focus();
      }
    }
  });
  // Add keyboard navigation help announcement
  const helpText = document.createElement("div");
  helpText.className = "visually-hidden";
  helpText.setAttribute("aria-live", "polite");
  helpText.id = "keyboard-help";
  helpText.textContent =
    "Keyboard shortcuts: Ctrl+A to select all, Ctrl+D to deselect all, Ctrl+E to export, Ctrl+F to search, Arrow keys to navigate cookies, Enter or Space to toggle selection";
  document.body.appendChild(helpText);
  console.log("Keyboard navigation initialized");
}
function initializeSearchControlsWithDebounce() {
  const searchInput = safeGetElement("search-input", "search input");
  if (!searchInput) return;
  // Create debounced search function
  const debouncedSearch = debounce((searchTerm) => {
    filterCookies(searchTerm);
  }, 300); // 300ms delay
  // Add input event listener with debouncing
  safeAddEventListener(
    searchInput,
    "input",
    (event) => {
      const value = event.target.value;
      searchTerm = value;
      // Show immediate visual feedback
      const searchSection = document.querySelector(".search-section");
      if (searchSection) {
        searchSection.classList.toggle("focused", value.length > 0);
      }
      // Debounced actual search
      debouncedSearch(value);
      // Also debounce the accessibility announcement
      const debouncedAnnouncement = debounce((term) => {
        announceSearchResults(term);
      }, 500);
      debouncedAnnouncement(value);
    },
    "search-input"
  );
  // Add focus/blur handlers for visual feedback
  safeAddEventListener(
    searchInput,
    "focus",
    () => {
      const searchSection = document.querySelector(".search-section");
      if (searchSection) {
        searchSection.classList.add("focused");
      }
    },
    "search-focus"
  );
  safeAddEventListener(
    searchInput,
    "blur",
    () => {
      const searchSection = document.querySelector(".search-section");
      if (searchSection && !searchInput.value) {
        searchSection.classList.remove("focused");
      }
    },
    "search-blur"
  );
  // Add keyboard support for search
  safeAddEventListener(
    searchInput,
    "keydown",
    (event) => {
      try {
        if (event.key === "Escape") {
          // Clear search on Escape key
          searchInput.value = "";
          filterCookies("");
          announceSearchResults("");
        } else if (event.key === "Enter") {
          // Prevent form submission on Enter
          event.preventDefault();
        } else if (event.key === "ArrowDown") {
          // Move focus to first cookie item
          event.preventDefault();
          focusFirstCookieItem();
        }
      } catch (error) {
        console.error("Search keyboard error:", error);
      }
    },
    "search-keyboard"
  );
  // Clear search when input is cleared
  safeAddEventListener(
    searchInput,
    "change",
    (event) => {
      try {
        if (!event.target.value.trim()) {
          filterCookies("");
        }
      } catch (error) {
        console.error("Search change error:", error);
      }
    },
    "search-change"
  );
  console.log("Search controls with debouncing initialized");
}
// Initialize when DOM is loaded with error handling
document.addEventListener("DOMContentLoaded", () => {
  try {
    initializePopup();
  } catch (error) {
    console.error("Failed to initialize popup:", error);
    displayError("Failed to initialize extension. Please try refreshing.");
  }
});
// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  cleanupEventListeners();
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  if (renderAnimationFrame) {
    cancelAnimationFrame(renderAnimationFrame);
  }
});
function renderCookieListOptimized(cookiesToRender = filteredCookies) {
  // Cancel any pending render
  if (renderAnimationFrame) {
    cancelAnimationFrame(renderAnimationFrame);
  }
  // Use requestAnimationFrame for smooth rendering
  renderAnimationFrame = requestAnimationFrame(() => {
    const cookieListElement = document.getElementById("cookie-list");
    const emptyState = document.getElementById("empty-state");
    if (!cookieListElement) {
      console.error("Cookie list element not found");
      return;
    }
    // Hide empty state if it was showing
    if (emptyState) {
      emptyState.style.display = "none";
    }
    // Check if we have cookies to render
    if (!cookiesToRender || cookiesToRender.length === 0) {
      // Clear existing content
      cookieListElement.innerHTML = "";
      if (emptyState) {
        // Show appropriate empty state message based on search
        if (searchTerm.trim()) {
          emptyState.innerHTML = `<span>No cookies found matching "${searchTerm}"</span>`;
        } else {
          emptyState.innerHTML = `<span>No cookies found for this domain</span>`;
        }
        emptyState.style.display = "flex";
      }
      // Update selection count and button states for empty state
      updateSelectionCount();
      return;
    }
    // Use virtual scrolling for large lists (>50 items)
    if (cookiesToRender.length > 50) {
      renderVirtualizedCookieList(cookiesToRender);
    } else {
      renderStandardCookieList(cookiesToRender);
    }
    // Update selection count display and button states
    updateSelectionCount();
  });
}
function renderVirtualizedCookieList(cookiesToRender) {
  const cookieListElement = document.getElementById("cookie-list");
  const container = document.getElementById("cookie-list-container");
  if (!cookieListElement || !container) return;
  // Set up virtual scrolling container
  const containerHeight = container.clientHeight;
  const visibleItems = Math.ceil(containerHeight / VIRTUAL_SCROLL_ITEM_HEIGHT);
  const totalHeight = cookiesToRender.length * VIRTUAL_SCROLL_ITEM_HEIGHT;
  // Create virtual scroll wrapper if it doesn't exist
  let virtualWrapper = cookieListElement.querySelector(
    ".virtual-scroll-wrapper"
  );
  if (!virtualWrapper) {
    virtualWrapper = document.createElement("div");
    virtualWrapper.className = "virtual-scroll-wrapper";
    virtualWrapper.style.height = `${totalHeight}px`;
    virtualWrapper.style.position = "relative";
    cookieListElement.appendChild(virtualWrapper);
  } else {
    virtualWrapper.style.height = `${totalHeight}px`;
  }
  // Create visible items container
  let visibleContainer = virtualWrapper.querySelector(".virtual-visible-items");
  if (!visibleContainer) {
    visibleContainer = document.createElement("div");
    visibleContainer.className = "virtual-visible-items";
    visibleContainer.style.position = "absolute";
    visibleContainer.style.top = "0";
    visibleContainer.style.width = "100%";
    virtualWrapper.appendChild(visibleContainer);
  }
  // Set ARIA attributes
  cookieListElement.setAttribute("role", "listbox");
  cookieListElement.setAttribute("aria-multiselectable", "true");
  cookieListElement.setAttribute(
    "aria-label",
    `${cookiesToRender.length} cookies available for selection`
  );
  // Function to update visible items
  const updateVisibleItems = () => {
    const scrollTop = container.scrollTop;
    const startIndex = Math.max(
      0,
      Math.floor(scrollTop / VIRTUAL_SCROLL_ITEM_HEIGHT) - VIRTUAL_SCROLL_BUFFER
    );
    const endIndex = Math.min(
      cookiesToRender.length,
      startIndex + visibleItems + VIRTUAL_SCROLL_BUFFER * 2
    );
    // Clear visible container
    visibleContainer.innerHTML = "";
    visibleContainer.style.transform = `translateY(${
      startIndex * VIRTUAL_SCROLL_ITEM_HEIGHT
    }px)`;
    // Render visible items
    for (let i = startIndex; i < endIndex; i++) {
      const cookie = cookiesToRender[i];
      const originalIndex = cookies.findIndex(
        (c) => c.name === cookie.name && c.domain === cookie.domain
      );
      const cookieItem = createCookieItemElement(cookie, originalIndex);
      visibleContainer.appendChild(cookieItem);
    }
  };
  // Add scroll listener with throttling
  let scrollTimeout;
  const throttledScroll = () => {
    if (scrollTimeout) return;
    scrollTimeout = requestAnimationFrame(() => {
      updateVisibleItems();
      scrollTimeout = null;
    });
  };
  // Remove existing scroll listener and add new one
  container.removeEventListener("scroll", container._virtualScrollHandler);
  container._virtualScrollHandler = throttledScroll;
  container.addEventListener("scroll", throttledScroll);
  // Initial render
  updateVisibleItems();
}
function renderStandardCookieList(cookiesToRender) {
  const cookieListElement = document.getElementById("cookie-list");
  if (!cookieListElement) return;
  // Clear existing content
  cookieListElement.innerHTML = "";
  // Set ARIA attributes for the cookie list
  cookieListElement.setAttribute("role", "listbox");
  cookieListElement.setAttribute("aria-multiselectable", "true");
  cookieListElement.setAttribute(
    "aria-label",
    `${cookiesToRender.length} cookies available for selection`
  );
  // Create document fragment for efficient DOM manipulation
  const fragment = document.createDocumentFragment();
  // Create cookie items in batches to avoid blocking the UI
  const batchSize = 20;
  let currentBatch = 0;
  const renderBatch = () => {
    const start = currentBatch * batchSize;
    const end = Math.min(start + batchSize, cookiesToRender.length);
    for (let i = start; i < end; i++) {
      const cookie = cookiesToRender[i];
      const originalIndex = cookies.findIndex(
        (c) => c.name === cookie.name && c.domain === cookie.domain
      );
      const cookieItem = createCookieItemElement(cookie, originalIndex);
      fragment.appendChild(cookieItem);
    }
    currentBatch++;
    if (end < cookiesToRender.length) {
      // Schedule next batch
      requestAnimationFrame(renderBatch);
    } else {
      // Append all items at once
      cookieListElement.appendChild(fragment);
    }
  };
  // Start rendering
  renderBatch();
}
function renderCookieList(cookiesToRender = filteredCookies) {
  renderCookieListOptimized(cookiesToRender);
}
function createCookieItemElement(cookie, index) {
  // Create main container
  const cookieContainer = document.createElement("div");
  cookieContainer.className = "cookie-container";
  cookieContainer.dataset.index = index;
  // Create the main cookie item row
  const cookieItem = document.createElement("div");
  cookieItem.className = `cookie-item ${cookie.selected ? "selected" : ""}`;
  cookieItem.setAttribute("role", "option");
  cookieItem.setAttribute("aria-selected", cookie.selected.toString());
  cookieItem.setAttribute("tabindex", "0");
  // Create checkbox
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "cookie-checkbox";
  checkbox.checked = cookie.selected;
  checkbox.id = `cookie-${index}`;
  checkbox.setAttribute("aria-label", `Select cookie ${cookie.name}`);
  // Create cookie info container
  const cookieInfo = document.createElement("div");
  cookieInfo.className = "cookie-info";
  // Create main info container (name + value preview)
  const cookieMainInfo = document.createElement("div");
  cookieMainInfo.className = "cookie-main-info";
  // Create cookie name
  const cookieName = document.createElement("div");
  cookieName.className = "cookie-name";
  if (searchTerm.trim()) {
    cookieName.innerHTML = highlightSearchTerm(cookie.name, searchTerm);
  } else {
    cookieName.textContent = cookie.name;
  }
  if (cookie.name.length > 20) {
    cookieName.title = cookie.name;
  }
  // Create value preview
  const cookieValuePreview = document.createElement("div");
  cookieValuePreview.className = "cookie-value-preview";
  const previewValue =
    cookie.value.length > 15
      ? cookie.value.substring(0, 15) + "..."
      : cookie.value;
  if (searchTerm.trim()) {
    cookieValuePreview.innerHTML = highlightSearchTerm(
      previewValue,
      searchTerm
    );
  } else {
    cookieValuePreview.textContent = previewValue;
  }
  // Create expand icon
  const expandIcon = document.createElement("div");
  expandIcon.className = "cookie-expand-icon";
  expandIcon.innerHTML = "▼";
  expandIcon.setAttribute("aria-label", "Expand cookie details");
  // Assemble main info
  cookieMainInfo.appendChild(cookieName);
  cookieMainInfo.appendChild(cookieValuePreview);
  // Assemble cookie info
  cookieInfo.appendChild(cookieMainInfo);
  cookieInfo.appendChild(expandIcon);
  // Assemble main cookie item
  cookieItem.appendChild(checkbox);
  cookieItem.appendChild(cookieInfo);
  // Create expandable details section
  const cookieDetails = document.createElement("div");
  cookieDetails.className = "cookie-details";
  // Add detail rows
  const detailRows = [
    { label: "Value:", value: cookie.value },
    { label: "Domain:", value: cookie.domain },
    { label: "Path:", value: cookie.path },
    { label: "Secure:", value: cookie.secure ? "Yes" : "No" },
    { label: "HttpOnly:", value: cookie.httpOnly ? "Yes" : "No" },
  ];
  detailRows.forEach((row) => {
    const detailRow = document.createElement("div");
    detailRow.className = "cookie-detail-row";
    const label = document.createElement("div");
    label.className = "cookie-detail-label";
    label.textContent = row.label;
    const value = document.createElement("div");
    value.className = "cookie-detail-value";
    value.textContent = row.value;
    detailRow.appendChild(label);
    detailRow.appendChild(value);
    cookieDetails.appendChild(detailRow);
  });
  // Assemble container
  cookieContainer.appendChild(cookieItem);
  cookieContainer.appendChild(cookieDetails);
  // Add click event for expanding the cookie (clicking anywhere on the item)
  cookieItem.addEventListener("click", (event) => {
    // Don't expand if clicking on checkbox
    if (event.target === checkbox) return;
    // Don't expand if clicking on expand icon (it has its own handler)
    if (event.target === expandIcon) return;
    // Expand/collapse the cookie details
    toggleCookieDetails(cookieContainer, expandIcon);
  });
  // Add click event for expand/collapse icon
  expandIcon.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleCookieDetails(cookieContainer, expandIcon);
  });
  // Add checkbox change event (only for checkbox clicks)
  checkbox.addEventListener("change", (event) => {
    event.stopPropagation();
    handleCookieSelection(index, checkbox.checked);
  });
  // Prevent checkbox clicks from bubbling to expand the cookie
  checkbox.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  // Add keyboard navigation
  cookieItem.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        // Enter expands/collapses the cookie
        toggleCookieDetails(cookieContainer, expandIcon);
        break;
      case " ":
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          // Ctrl+Space or Cmd+Space toggles checkbox
          checkbox.checked = !checkbox.checked;
          handleCookieSelection(index, checkbox.checked);
        } else {
          // Space expands/collapses the cookie
          toggleCookieDetails(cookieContainer, expandIcon);
        }
        break;
      case "ArrowDown":
        event.preventDefault();
        focusNextCookieItem(cookieItem);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusPreviousCookieItem(cookieItem);
        break;
    }
  });
  return cookieContainer;
}
function toggleCookieDetails(container, expandIcon) {
  const details = container.querySelector(".cookie-details");
  const item = container.querySelector(".cookie-item");
  if (details.classList.contains("expanded")) {
    details.classList.remove("expanded");
    expandIcon.classList.remove("expanded");
    item.classList.remove("expanded");
    expandIcon.innerHTML = "▼";
    expandIcon.setAttribute("aria-label", "Expand cookie details");
  } else {
    details.classList.add("expanded");
    expandIcon.classList.add("expanded");
    item.classList.add("expanded");
    expandIcon.innerHTML = "▲";
    expandIcon.setAttribute("aria-label", "Collapse cookie details");
  }
}
function handleCookieSelection(index, selected) {
  if (index < 0 || index >= cookies.length) {
    console.error("Invalid cookie index:", index);
    return;
  }
  // Update cookie selection state
  cookies[index].selected = selected;
  // Update visual state
  const cookieItem = document.querySelector(`[data-index="${index}"]`);
  const checkbox = cookieItem?.querySelector(".cookie-checkbox");
  if (cookieItem) {
    if (selected) {
      cookieItem.classList.add("selected");
      cookieItem.setAttribute("aria-selected", "true");
    } else {
      cookieItem.classList.remove("selected");
      cookieItem.setAttribute("aria-selected", "false");
    }
  }
  // Ensure checkbox state is synchronized
  if (checkbox && checkbox.checked !== selected) {
    checkbox.checked = selected;
  }
  // Update selection count and button states
  updateSelectionCount();
  // Announce selection change to screen readers
  announceSelectionChange(cookies[index].name, selected);
  console.log(
    `Cookie "${cookies[index].name}" ${selected ? "selected" : "deselected"}`
  );
}
function announceSelectionChange(cookieName, selected) {
  const announcement = document.createElement("div");
  announcement.setAttribute("aria-live", "polite");
  announcement.setAttribute("aria-atomic", "true");
  announcement.className = "visually-hidden";
  announcement.textContent = `Cookie ${cookieName} ${
    selected ? "selected" : "deselected"
  }`;
  document.body.appendChild(announcement);
  // Remove the announcement after a short delay
  setTimeout(() => {
    document.body.removeChild(announcement);
  }, 1000);
}
function updateSelectionCount() {
  selectedCount = cookies.filter((cookie) => cookie.selected).length;
  // Update selection count display
  const selectionCountElement = document.getElementById("selection-count");
  if (selectionCountElement) {
    const totalCount = cookies.length;
    selectionCountElement.textContent = `${selectedCount} of ${totalCount} selected`;
    // Add visual feedback for selection
    if (selectedCount > 0) {
      selectionCountElement.classList.add("has-selection");
    } else {
      selectionCountElement.classList.remove("has-selection");
    }
  }
  // Update export button states
  const exportButton = document.getElementById("export-btn");
  const exportAsButton = document.getElementById("export-as-btn");
  const copyButton = document.getElementById("copy-btn");
  const buttonsDisabled = selectedCount === 0;
  if (exportButton) {
    exportButton.disabled = buttonsDisabled;
    exportButton.textContent =
      selectedCount > 0 ? `Export (${selectedCount})` : "Export";
  }
  if (exportAsButton) {
    exportAsButton.disabled = buttonsDisabled;
    exportAsButton.textContent =
      selectedCount > 0 ? `Export As (${selectedCount})` : "Export As";
  }
  if (copyButton) {
    copyButton.disabled = buttonsDisabled;
    copyButton.textContent =
      selectedCount > 0 ? `Copy (${selectedCount})` : "Copy";
  }
  // Update control buttons state
  const selectAllBtn = document.getElementById("select-all-btn");
  const deselectAllBtn = document.getElementById("deselect-all-btn");
  if (selectAllBtn) {
    selectAllBtn.disabled = selectedCount === cookies.length;
    if (selectedCount === cookies.length) {
      selectAllBtn.setAttribute(
        "aria-label",
        "Select all cookies. All cookies are already selected."
      );
    } else {
      selectAllBtn.setAttribute(
        "aria-label",
        `Select all ${cookies.length} cookies. Currently ${selectedCount} selected.`
      );
    }
  }
  if (deselectAllBtn) {
    deselectAllBtn.disabled = selectedCount === 0;
    if (selectedCount === 0) {
      deselectAllBtn.setAttribute(
        "aria-label",
        "Deselect all cookies. No cookies are currently selected."
      );
    } else {
      deselectAllBtn.setAttribute(
        "aria-label",
        `Deselect all cookies. Currently ${selectedCount} selected.`
      );
    }
  }
}
function displayEmptyState() {
  const cookieListElement = document.getElementById("cookie-list");
  const emptyState = document.getElementById("empty-state");
  if (cookieListElement) {
    cookieListElement.innerHTML = "";
  }
  if (emptyState) {
    emptyState.style.display = "flex";
  }
}
function handleSelectAll() {
  if (filteredCookies.length === 0) {
    console.log("No cookies to select");
    return;
  }
  // Only select cookies that are currently visible (filtered)
  filteredCookies.forEach((cookie) => {
    const originalIndex = cookies.findIndex(
      (c) => c.name === cookie.name && c.domain === cookie.domain
    );
    if (originalIndex !== -1) {
      cookies[originalIndex].selected = true;
      // Update visual state for each cookie item
      const cookieItem = document.querySelector(
        `[data-index="${originalIndex}"]`
      );
      const checkbox = cookieItem?.querySelector(".cookie-checkbox");
      if (cookieItem) {
        cookieItem.classList.add("selected");
      }
      if (checkbox) {
        checkbox.checked = true;
      }
    }
  });
  updateSelectionCount();
  console.log(`Selected all ${filteredCookies.length} visible cookies`);
}
function handleDeselectAll() {
  if (filteredCookies.length === 0) {
    console.log("No cookies to deselect");
    return;
  }
  // Only deselect cookies that are currently visible (filtered)
  filteredCookies.forEach((cookie) => {
    const originalIndex = cookies.findIndex(
      (c) => c.name === cookie.name && c.domain === cookie.domain
    );
    if (originalIndex !== -1) {
      cookies[originalIndex].selected = false;
      // Update visual state for each cookie item
      const cookieItem = document.querySelector(
        `[data-index="${originalIndex}"]`
      );
      const checkbox = cookieItem?.querySelector(".cookie-checkbox");
      if (cookieItem) {
        cookieItem.classList.remove("selected");
      }
      if (checkbox) {
        checkbox.checked = false;
      }
    }
  });
  updateSelectionCount();
  console.log("Deselected all visible cookies");
}
function initializeSelectionControls() {
  const selectAllBtn = safeGetElement("select-all-btn", "Select All button");
  const deselectAllBtn = safeGetElement(
    "deselect-all-btn",
    "Deselect All button"
  );
  if (selectAllBtn) {
    safeAddEventListener(selectAllBtn, "click", handleSelectAll, "select-all");
    // Add keyboard support
    safeAddEventListener(
      selectAllBtn,
      "keydown",
      (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleSelectAll();
        }
      },
      "select-all-keyboard"
    );
  }
  if (deselectAllBtn) {
    safeAddEventListener(
      deselectAllBtn,
      "click",
      handleDeselectAll,
      "deselect-all"
    );
    // Add keyboard support
    safeAddEventListener(
      deselectAllBtn,
      "keydown",
      (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleDeselectAll();
        }
      },
      "deselect-all-keyboard"
    );
  }
  console.log("Selection controls initialized");
}
function filterCookies(term) {
  searchTerm = term.trim();
  if (!searchTerm) {
    // If no search term, show all cookies
    filteredCookies = [...cookies];
  } else {
    // Filter cookies by name or value containing the search term (case-insensitive)
    // Use more efficient filtering for large datasets
    const lowerSearchTerm = searchTerm.toLowerCase();
    filteredCookies = cookies.filter(
      (cookie) =>
        cookie.name.toLowerCase().includes(lowerSearchTerm) ||
        cookie.value.toLowerCase().includes(lowerSearchTerm)
    );
  }
  // Re-render the cookie list with optimized rendering
  renderCookieListOptimized(filteredCookies);
  console.log(
    `Filtered cookies: ${filteredCookies.length} of ${cookies.length} cookies match "${searchTerm}"`
  );
}
function highlightSearchTerm(text, term) {
  if (!term.trim()) {
    return text;
  }
  // Escape special regex characters in the search term
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Create regex for case-insensitive matching
  const regex = new RegExp(`(${escapedTerm})`, "gi");
  // Replace matches with highlighted spans
  return text.replace(regex, '<mark class="search-highlight">$1</mark>');
}
function initializeSearchControls() {
  // Delegate to the optimized version
  initializeSearchControlsWithDebounce();
}
function announceSearchResults(searchTerm) {
  const resultCount = filteredCookies.length;
  let message;
  if (!searchTerm.trim()) {
    message = `Showing all ${cookies.length} cookies`;
  } else if (resultCount === 0) {
    message = `No cookies found matching "${searchTerm}"`;
  } else if (resultCount === 1) {
    message = `1 cookie found matching "${searchTerm}"`;
  } else {
    message = `${resultCount} cookies found matching "${searchTerm}"`;
  }
  // Use a debounced announcement to avoid overwhelming screen readers
  clearTimeout(window.searchAnnouncementTimeout);
  window.searchAnnouncementTimeout = setTimeout(() => {
    const announcement = document.createElement("div");
    announcement.setAttribute("aria-live", "polite");
    announcement.setAttribute("aria-atomic", "true");
    announcement.className = "visually-hidden";
    announcement.textContent = message;
    document.body.appendChild(announcement);
    setTimeout(() => {
      if (document.body.contains(announcement)) {
        document.body.removeChild(announcement);
      }
    }, 1000);
  }, 500);
}
function initializeExportControls() {
  const exportBtn = safeGetElement("export-btn", "Export button");
  const exportAsBtn = safeGetElement("export-as-btn", "Export As button");
  const copyBtn = safeGetElement("copy-btn", "Copy button");
  if (!exportBtn || !exportAsBtn || !copyBtn) {
    console.error("One or more export buttons not found");
    return;
  }
  // Export button - use selected format, save directly
  exportBtn.addEventListener("click", async (event) => {
    if (exportBtn.disabled) return;
    const formatSelect = document.getElementById("export-format");
    const selectedFormat = formatSelect ? formatSelect.value : "json";
    await handleExport(selectedFormat, false); // false = save directly without asking
  });
  // Export As button - use selected format, ask where to save
  exportAsBtn.addEventListener("click", async (event) => {
    if (exportAsBtn.disabled) return;
    const formatSelect = document.getElementById("export-format");
    const selectedFormat = formatSelect ? formatSelect.value : "json";
    await handleExport(selectedFormat, true); // true = show save dialog
  });
  // Copy button - copy to clipboard in selected format
  copyBtn.addEventListener("click", async (event) => {
    if (copyBtn.disabled) return;
    const formatSelect = document.getElementById("export-format");
    const selectedFormat = formatSelect ? formatSelect.value : "json";
    await handleCopy(selectedFormat);
  });
  // Add keyboard support for all buttons
  exportBtn.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!exportBtn.disabled) {
        exportBtn.click();
      }
    }
  });
  exportAsBtn.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!exportAsBtn.disabled) {
        exportAsBtn.click();
      }
    }
  });
  copyBtn.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!copyBtn.disabled) {
        copyBtn.click();
      }
    }
  });
  console.log("Export controls initialized");
}
async function handleExport(format, saveAs = true) {
  try {
    const selectedCookies = cookies.filter((cookie) => cookie.selected);
    if (selectedCookies.length === 0) {
      showTemporaryMessage("No cookies selected");
      return;
    }
    let content, filename, mimeType;
    switch (format) {
      case "json":
        content = generateJSONExport(selectedCookies);
        filename = `cookies_${currentDomain}_${
          new Date().toISOString().split("T")[0]
        }.json`;
        mimeType = "application/json";
        break;
      case "json-all":
        content = generateJSONAllExport(selectedCookies);
        filename = `cookies_all_${currentDomain}_${
          new Date().toISOString().split("T")[0]
        }.json`;
        mimeType = "application/json";
        break;
      case "netscape":
        content = generateNetscapeExport(selectedCookies);
        filename = `cookies_${currentDomain}_${
          new Date().toISOString().split("T")[0]
        }.txt`;
        mimeType = "text/plain";
        break;
      default:
        throw new Error("Invalid export format");
    }
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: saveAs,
    });
    showTemporaryMessage(`Export as ${format.toUpperCase()} initiated!`);
  } catch (error) {
    console.error("Export failed:", error);
    showTemporaryMessage("Export failed");
  }
}
async function handleCopy(format) {
  try {
    const selectedCookies = cookies.filter((cookie) => cookie.selected);
    if (selectedCookies.length === 0) {
      showTemporaryMessage("No cookies selected");
      return;
    }
    let content;
    switch (format) {
      case "json":
        content = generateJSONExport(selectedCookies);
        break;
      case "json-all":
        content = generateJSONAllExport(selectedCookies);
        break;
      case "netscape":
        content = generateNetscapeExport(selectedCookies);
        break;
      default:
        throw new Error("Invalid copy format");
    }
    await navigator.clipboard.writeText(content);
    showTemporaryMessage(`Copied as ${format.toUpperCase()} to clipboard!`);
  } catch (error) {
    console.error("Copy failed:", error);
    showTemporaryMessage("Copy failed");
  }
}
function generateJSONExport(selectedCookies) {
  const exportData = {};
  selectedCookies.forEach((cookie) => {
    exportData[cookie.name] = cookie.value;
  });
  return JSON.stringify(exportData, null, 2);
}
function generateJSONAllExport(selectedCookies) {
  const exportData = selectedCookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
  }));
  return JSON.stringify(exportData, null, 2);
}
function generateNetscapeExport(selectedCookies) {
  let content = "# Netscape HTTP Cookie File\n";
  content += "# Generated by Cookie Selector Extension\n";
  content += "# This is a generated file! Do not edit.\n\n";
  selectedCookies.forEach((cookie) => {
    const domain = cookie.domain.startsWith(".")
      ? cookie.domain
      : `.${cookie.domain}`;
    const flag = cookie.domain.startsWith(".") ? "TRUE" : "FALSE";
    const path = cookie.path || "/";
    const secure = cookie.secure ? "TRUE" : "FALSE";
    const expires = "0"; // Session cookie
    content += `${domain}\t${flag}\t${path}\t${secure}\t${expires}\t${cookie.name}\t${cookie.value}\n`;
  });
  return content;
}
function showMoreOptions() {
  // Create a simple dropdown menu or modal with additional options
  const moreOptions = [
    { label: "Copy All Cookie Names", action: () => copyAllCookieNames() },
    { label: "Copy Selected Values", action: () => copySelectedValues() },
    { label: "Export as CSV", action: () => exportAsCSV() },
    { label: "Clear All Cookies", action: () => clearAllCookies() },
    { label: "Refresh Cookie List", action: () => refreshCookieList() },
  ];
  // For now, let's just show an alert with the options
  // In a more advanced implementation, you could create a proper dropdown
  const optionText = moreOptions
    .map((opt, index) => `${index + 1}. ${opt.label}`)
    .join("\n");
  const choice = prompt(
    `Choose an option:\n\n${optionText}\n\nEnter the number (1-5):`
  );
  const optionIndex = parseInt(choice) - 1;
  if (optionIndex >= 0 && optionIndex < moreOptions.length) {
    moreOptions[optionIndex].action();
  }
}
async function copyAllCookieNames() {
  try {
    const cookieNames = cookies.map((cookie) => cookie.name).join("\n");
    await navigator.clipboard.writeText(cookieNames);
    showTemporaryMessage("Cookie names copied to clipboard!");
  } catch (error) {
    console.error("Failed to copy cookie names:", error);
    showTemporaryMessage("Failed to copy cookie names");
  }
}
async function copySelectedValues() {
  try {
    const selectedCookies = cookies.filter((cookie) => cookie.selected);
    if (selectedCookies.length === 0) {
      showTemporaryMessage("No cookies selected");
      return;
    }
    const values = selectedCookies
      .map((cookie) => `${cookie.name}: ${cookie.value}`)
      .join("\n");
    await navigator.clipboard.writeText(values);
    showTemporaryMessage("Selected cookie values copied to clipboard!");
  } catch (error) {
    console.error("Failed to copy cookie values:", error);
    showTemporaryMessage("Failed to copy cookie values");
  }
}
async function exportAsCSV() {
  try {
    const selectedCookies = cookies.filter((cookie) => cookie.selected);
    if (selectedCookies.length === 0) {
      showTemporaryMessage("No cookies selected");
      return;
    }
    const csvHeader = "Name,Value,Domain,Path,Secure,HttpOnly\n";
    const csvRows = selectedCookies
      .map(
        (cookie) =>
          `"${cookie.name}","${cookie.value}","${cookie.domain}","${cookie.path}","${cookie.secure}","${cookie.httpOnly}"`
      )
      .join("\n");
    const csvContent = csvHeader + csvRows;
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const filename = `cookies_${currentDomain}_${
      new Date().toISOString().split("T")[0]
    }.csv`;
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true,
    });
    showTemporaryMessage("CSV export initiated!");
  } catch (error) {
    console.error("Failed to export CSV:", error);
    showTemporaryMessage("Failed to export CSV");
  }
}
async function clearAllCookies() {
  const confirmClear = confirm(
    `Are you sure you want to clear ALL cookies for ${currentDomain}? This action cannot be undone.`
  );
  if (!confirmClear) return;
  try {
    let deletedCount = 0;
    for (const cookie of cookies) {
      await chrome.cookies.remove({
        url: `http${cookie.secure ? "s" : ""}://${cookie.domain}${cookie.path}`,
        name: cookie.name,
      });
      deletedCount++;
    }
    showTemporaryMessage(`Deleted ${deletedCount} cookies`);
    // Refresh the cookie list
    await loadCookies();
  } catch (error) {
    console.error("Failed to clear cookies:", error);
    showTemporaryMessage("Failed to clear cookies");
  }
}
async function refreshCookieList() {
  try {
    showTemporaryMessage("Refreshing cookie list...");
    await loadCookies();
    showTemporaryMessage("Cookie list refreshed!");
  } catch (error) {
    console.error("Failed to refresh cookie list:", error);
    showTemporaryMessage("Failed to refresh cookie list");
  }
}
function showTemporaryMessage(message) {
  // Create a temporary toast message
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #1a73e8;
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 1000;
    max-width: 300px;
  `;
  document.body.appendChild(toast);
  // Remove after 3 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 3000);
}
async function exportSelectedCookies() {
  let exportLoadingOverlay = null;
  try {
    // Validate that cookies are selected
    const selectedCookies = cookies.filter((cookie) => cookie.selected);
    if (selectedCookies.length === 0) {
      displayExportError("Please select at least one cookie to export.");
      return;
    }
    // Show export loading overlay
    exportLoadingOverlay = showExportLoading("Preparing export...");
    // Show progress
    showProgress(10);
    // Generate JSON format (key-value pairs only)
    updateExportLoadingMessage(exportLoadingOverlay, "Generating JSON...");
    showProgress(30);
    const exportData = {};
    selectedCookies.forEach((cookie) => {
      exportData[cookie.name] = cookie.value;
    });
    // Convert to JSON string with proper formatting
    const jsonString = JSON.stringify(exportData, null, 2);
    // Validate JSON size (warn if very large)
    if (jsonString.length > 1024 * 1024) {
      // 1MB
      console.warn("Large export file detected:", jsonString.length, "bytes");
    }
    // Generate filename using domain name
    const filename = `${currentDomain}.json`;
    showProgress(50);
    // Create blob for download
    updateExportLoadingMessage(exportLoadingOverlay, "Creating download...");
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    showProgress(70);
    // Attempt download with multiple fallback methods
    let downloadSuccess = false;
    let downloadMethod = "unknown";
    // Method 1: Chrome downloads API (preferred)
    if (chrome.downloads && !downloadSuccess) {
      try {
        updateExportLoadingMessage(
          exportLoadingOverlay,
          "Starting download..."
        );
        await chrome.downloads.download({
          url: url,
          filename: filename,
          saveAs: false,
        });
        downloadSuccess = true;
        downloadMethod = "chrome-api";
        showProgress(100);
      } catch (downloadError) {
        console.warn("Chrome downloads API failed:", downloadError);
        // Continue to fallback methods
      }
    }
    // Method 2: Traditional download link (fallback)
    if (!downloadSuccess) {
      try {
        updateExportLoadingMessage(
          exportLoadingOverlay,
          "Using fallback download..."
        );
        const downloadLink = document.createElement("a");
        downloadLink.href = url;
        downloadLink.download = filename;
        downloadLink.style.display = "none";
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        downloadSuccess = true;
        downloadMethod = "fallback";
        showProgress(100);
      } catch (fallbackError) {
        console.error("Fallback download failed:", fallbackError);
      }
    }
    // Method 3: Copy to clipboard as last resort
    if (!downloadSuccess) {
      try {
        updateExportLoadingMessage(
          exportLoadingOverlay,
          "Copying to clipboard..."
        );
        await navigator.clipboard.writeText(jsonString);
        downloadSuccess = true;
        downloadMethod = "clipboard";
        showProgress(100);
        showExportSuccess(
          selectedCookies.length,
          "clipboard",
          "Cookies copied to clipboard as JSON"
        );
      } catch (clipboardError) {
        console.error("Clipboard copy failed:", clipboardError);
        throw new Error(
          "All export methods failed. Please try again or check browser permissions."
        );
      }
    }
    // Clean up the blob URL
    URL.revokeObjectURL(url);
    if (downloadSuccess && downloadMethod !== "clipboard") {
      console.log(
        `Successfully exported ${selectedCookies.length} cookies to ${filename} using ${downloadMethod}`
      );
      showExportSuccess(selectedCookies.length, filename);
    }
  } catch (error) {
    console.error("Error exporting cookies:", error);
    // Provide specific error messages based on error type
    let errorMessage = "Export failed. Please try again.";
    if (error.message.includes("permissions")) {
      errorMessage =
        "Export failed due to permissions. Please check browser settings.";
    } else if (
      error.message.includes("quota") ||
      error.message.includes("storage")
    ) {
      errorMessage =
        "Export failed due to storage limitations. Please free up space and try again.";
    } else if (error.message.includes("network")) {
      errorMessage =
        "Export failed due to network issues. Please check your connection.";
    } else if (error.message.includes("All export methods failed")) {
      errorMessage = error.message;
    }
    displayExportError(errorMessage);
  } finally {
    // Hide loading states
    if (exportLoadingOverlay) {
      hideExportLoading(exportLoadingOverlay);
    }
    hideProgress();
  }
}
function showExportLoading(message) {
  const overlay = document.createElement("div");
  overlay.className = "loading-state export-loading";
  overlay.innerHTML = `
    <div class="spinner large"></div>
    <span class="export-loading-message">${message}</span>
  `;
  document.body.appendChild(overlay);
  return overlay;
}
function updateExportLoadingMessage(overlay, message) {
  if (overlay) {
    const messageElement = overlay.querySelector(".export-loading-message");
    if (messageElement) {
      messageElement.textContent = message;
    }
  }
}
function hideExportLoading(overlay) {
  if (overlay && overlay.parentNode) {
    overlay.parentNode.removeChild(overlay);
  }
}
function displayExportError(message) {
  // Remove loading state from export button
  const exportBtn = document.getElementById("export-btn");
  if (exportBtn) {
    exportBtn.classList.remove("loading");
  }
  // Create temporary error notification
  const errorNotification = document.createElement("div");
  errorNotification.className = "export-error-notification";
  errorNotification.innerHTML = `<span>${message}</span>`;
  document.body.appendChild(errorNotification);
  // Remove notification after 3 seconds
  setTimeout(() => {
    if (errorNotification.parentNode) {
      errorNotification.parentNode.removeChild(errorNotification);
    }
  }, 3000);
}
function showExportSuccess(count, filename, customMessage = null) {
  // Create success overlay flash effect
  const successOverlay = document.createElement("div");
  successOverlay.className = "success-overlay";
  document.body.appendChild(successOverlay);
  // Remove overlay after animation
  setTimeout(() => {
    if (successOverlay.parentNode) {
      successOverlay.parentNode.removeChild(successOverlay);
    }
  }, 600);
  // Update export button to show success state
  const exportBtn = document.getElementById("export-btn");
  if (exportBtn) {
    exportBtn.classList.remove("loading");
    exportBtn.classList.add("success");
    // Reset button state after animation
    setTimeout(() => {
      exportBtn.classList.remove("success");
    }, 2000);
  }
  // Create temporary success notification
  const successNotification = document.createElement("div");
  successNotification.className = "export-success-notification";
  let message;
  if (customMessage) {
    message = customMessage;
  } else if (filename === "clipboard") {
    message = `Successfully copied ${count} cookie${
      count === 1 ? "" : "s"
    } to clipboard`;
  } else {
    message = `Successfully exported ${count} cookie${
      count === 1 ? "" : "s"
    } to ${filename}`;
  }
  successNotification.innerHTML = `<span>${message}</span>`;
  document.body.appendChild(successNotification);
  // Remove notification after duration with fade out
  const duration = filename === "clipboard" ? 4000 : 3000;
  setTimeout(() => {
    if (successNotification.parentNode) {
      successNotification.style.opacity = "0";
      successNotification.style.transform =
        "translateX(-50%) translateY(-20px) scale(0.9)";
      setTimeout(() => {
        if (successNotification.parentNode) {
          successNotification.parentNode.removeChild(successNotification);
        }
      }, 300);
    }
  }, duration);
}
