/*
DELAY is set to 6 seconds in this example. Such a short period is chosen to make
the extension's behavior more obvious, but this is not recommended in real life.
Note that in Chrome, alarms cannot be set for less than a minute. In Chrome:

* if you install this extension "unpacked", you'll see a warning
in the console, but the alarm will still go off after 6 seconds
* if you package the extension and install it, then the alarm will go off after
a minute.
*/
const isChrome = !("browser" in self);
if (isChrome) {
  importScripts("browser-polyfill-dist/browser-polyfill.min.js");
  // Wrap in an onInstalled callback to avoid unnecessary work
  // every time the service worker is run
  browser.runtime.onInstalled.addListener(() => {
    console.log("INstall");
    // Page actions are disabled by default and enabled on select tabs
    // browser.action.disable();

    // // Clear all rules to ensure only our expected rules are set
    // browser.declarativeContent.onPageChanged.removeRules(undefined, () => {
    //   // Declare a rule to enable the action on example.com pages
    //   let exampleRule = {
    //     conditions: [
    //       new browser.declarativeContent.PageStateMatcher({
    //         pageUrl: { hostEquals: "github.com" },
    //       }),
    //     ],
    //     actions: [new browser.declarativeContent.ShowAction()],
    //   };

    //   // Finally, apply our new array of rules
    //   let rules = [exampleRule];
    //   browser.declarativeContent.onPageChanged.addRules(rules);
    // });
  });
}

function printStorage() {
  browser.storage.local.get().then((storage) => {
    console.log(storage);
  });
}

let firefoxPageAction = isChrome ? browser.action : browser.pageAction;
let DELAY = 0.1;
let CATGIFS = "https://giphy.com/explore/cat";
let defaultList = { "github.com": { time: 0 } };
let whitelist = [];
let lastWhitelistURL = "";

let currentTimer = {
  page: "PLACEHOLDER",
  timerRunning: false,
  startDate: new Date(),
  endDate: new Date(),
};

const escapeHTML = (unsafe_html) =>
  unsafe_html.replace(
    /[&<>'"]/g,
    (tag) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      }[tag] || tag)
  );

// Handle Messages sent by popup
function handleMessage(request, sender, sendResponse) {
  console.log(sender);
  console.log(request);
  switch (request.type) {
    case "getSettings":
      sendResponse({ response: currentTimer });
      break;
    case "setTimerRunning":
      setTimerRunning(request.data, sendResponse);
      break;
    case "submitSession":
      submitSession(request.data, sendResponse);
      break;
    case "deleteSession":
      deleteSession(request.data.project, request.data.startTime, sendResponse);
      break;
    default:
      console.warn("Unknown Message: ", request);
      break;
  }
  return true;
}

function init() {
  const gettingStoredSettings = browser.storage.local.get();
  gettingStoredSettings.then(checkStoredSettings, onError);
  browser.runtime.onMessage.addListener(handleMessage);
}
init();

function timeofDayName(time) {
  let hour = new Date(time * 1000).getHours();
  var start_night = 0;
  var start_morning = 6;
  var start_afternoon = 14; //24hr time to split the afternoon
  var start_evening = 18; //24hr time to split the evening

  let timeOfDay;
  if (hour >= start_afternoon && hour <= start_evening) {
    // 14-18 incl
    timeOfDay = "afternoon";
  } else if (hour > start_evening || hour < start_night) {
    // 19-23 incl
    timeOfDay = "evening";
  } else if (hour < start_morning) {
    // 0-5
    timeOfDay = "nightly";
  } else {
    timeOfDay = "morning";
  }
  return "My " + timeOfDay + " sesh.";
}

function dateIsValid(...dates) {
  dates.forEach((date) => {
    if (!(date instanceof Date) || isNaN(date)) {
      return false;
    }
  });
  return true;
}

const combineDateAndTime = function (date, time) {
  console.log(date.getFullYear(), date.getMonth(), date.getDate(), time.getHours(), time.getMinutes());
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.getHours(), time.getMinutes());
};

function submitSession(data, sendResponse) {
  // appendToSessions(data.project, data.)
  const project = data.project;
  const notes = data.notes;

  const date = data.date;
  const start = data.start;
  const end = data.end;
  const startTime = combineDateAndTime(date, start);
  const endTime = combineDateAndTime(date, end);
  console.log(startTime);
  console.log(endTime);
  const datesValid = dateIsValid(date, start, end, startTime, endTime);
  if (datesValid) {
    appendToSessions(project, startTime.getTime() / 1000, endTime.getTime() / 1000, notes).then(() =>
      sendResponse({ success: false })
    );
  } else {
    console.log("invalid date or time submitted");
    sendResponse({ success: false });
  }
}

function appendToSessions(project, startTime, endTime, notes) {
  return new Promise(function (resolve, reject) {
    project = escapeHTML(project);
    notes = escapeHTML(notes);
    while (startTime > endTime && endTime > 86400) {
      endTime += 86400; // add 1 day
    }
    browser.storage.local.get(["sessions"]).then((result) => {
      let newSession = {};
      let sessions = result.sessions || {};
      newSession.name = timeofDayName(endTime);
      newSession.endDate = endTime;
      newSession.timerRunning = false;
      sessions[project] = sessions[project] || {};
      sessions[project][startTime] = {
        // TODO: change name to notes
        notes: timeofDayName(endTime) + "<br>" + notes,
        endDate: endTime,
      };
      browser.storage.local.set({ current: newSession, sessions }).then(resolve, reject);
    }, reject);
  });
}

function deleteSession(project, startTime, sendResponse) {
  browser.storage.local.get(["sessions"]).then((result) => {
    let sessions = result.sessions || {};
    let session_exists = project in sessions && startTime in sessions[project];
    if (session_exists) {
      delete sessions[project][startTime];
      browser.storage.local.set({ sessions }).then(() => {
        sendResponse({ success: true });
      });
    } else {
      sendResponse({ success: false });
    }
  });
}

function logTabs(windowInfo) {
  console.log(windowInfo);
}

function onError(error) {
  console.error(`Error: ${error}`);
}

// browser.windows.getCurrent({ populate: true }).then(logTabs, onError);

function setTimerRunning(data, sendResponse) {
  let projName = data.project;
  let projNotes = data.notes;
  let timerStarting = data.starting;
  browser.action.setBadgeText({ text: timerStarting ? "ON" : "OFF" });
  let current = {
    timerRunning: timerStarting,
    page: projName,
  };
  let now = new Date();
  now.setMilliseconds(0);
  now.setSeconds(0);
  let nowUnix = now.getTime() / 1000;
  if (timerStarting) {
    current.startDate = nowUnix;
    browser.storage.local.set({ current });
    sendResponse({ started: timerStarting });
  } else {
    // stopped time, get start time save sesh
    browser.storage.local.get(["current"]).then((storage) => {
      if (storage.current.startDate) {
        appendToSessions(projName, storage.current.startDate, nowUnix, projNotes).then(() =>
          sendResponse({ started: timerStarting })
        );
      }
    });
  }

  //   sendResponse({ current: bgSettings });
  //   browser.windows.getCurrent().then((w) => {
  //     let gettingActiveTab = browser.tabs.query({
  //       active: true,
  //       windowId: w.id,
  //     });
  //     gettingActiveTab.then((tabs) => {
  //       let urlObj = new URL(tabs[0].url);
  //       let domain = urlObj.hostname === "" ? "Unnamed Tab" : urlObj.hostname.replace("www.", "");
  //     });
  //   });
}

/*
Default settings. Initialize storage to these values.
*/

function checkStoredSettings(storedSettings) {
  if (!storedSettings.Whitelist || !storedSettings.Whitelist.length) {
    storedSettings = { Whitelist: defaultList };
    browser.storage.local.set(storedSettings);
  }
  whitelist = storedSettings.Whitelist;
}

/*
Restart alarm for the currently active tab, whenever background.js is run.
let gettingActiveTab = browser.tabs.query({
  active: true,
  currentWindow: true,
});
gettingActiveTab.then((tabs) => {
  restartAlarm(tabs[0].id);
});
*/

function checkWhitelist(cURL) {
  if (Object.keys(whitelist).length) {
    let urlObj = new URL(cURL);
    let domain = urlObj.hostname.replace("www.", "");
    console.log(domain);
    let isWhitelisted = Object.keys(whitelist).includes(domain);
    if (isWhitelisted) {
      lastWhitelistURL = domain;
      return true;
    } else {
      return false;
    }
  }
}

/*
  FIREFOX COOLNESS
*/
if (!isChrome) {
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    console.log(tab);
    if (!tab.url) {
      return;
    }
    let gettingActiveTab = browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    gettingActiveTab.then((tabs) => {
      if (tabId == tabs[0].id && checkWhitelist(tab.url)) {
        firefoxPageAction.show(tabs[0].id);
      }
    });
  });
  /*
Restart alarm for the currently active tab, whenever a new tab becomes active.
browser.tabs.onActivated.addListener((activeInfo) => {
  restartAlarm(activeInfo.tabId);
});
*/

  /*
restartAlarm: clear all alarms,
then set a new alarm for the given tab.
*/
  function restartAlarm(tabId) {
    firefoxPageAction.hide(tabId);
    browser.alarms.clearAll();
    let gettingTab = browser.tabs.get(tabId);
    gettingTab.then((tab) => {
      if (tab.url != CATGIFS) {
        browser.alarms.create("", { periodInMinutes: DELAY });
      }
    });

    /*
	On alarm, show the page action.
	*/
    browser.alarms.onAlarm.addListener((alarm) => {
      let gettingActiveTab = browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      gettingActiveTab.then((tabs) => {
        firefoxPageAction.show(tabs[0].id);
      });
    });

    /*
	On page action click, navigate the corresponding tab to the cat gifs.
	*/
    firefoxPageAction.onClicked.addListener(() => {
      browser.tabs.update({ url: CATGIFS });
    });
  }
}
