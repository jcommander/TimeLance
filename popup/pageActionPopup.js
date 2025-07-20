/*
This file should only be used for 'frontend' logic/code as it is only loaded while the popup is open

Addon logic like the timer is handled by background.js and called like this
    browser.runtime
      .sendMessage({ type: "setTimerRunning", data: nowStarting })
      .then(handleStorageOnStartup, onError);
*/
import Datepicker from "../node_modules/vanillajs-datepicker/js/Datepicker.js";

const use24HourFormat = true;

const isChrome = !("browser" in self);

//#region Timing Formatters
function padTo2Digits(num) {
  return num.toString().padStart(2, "0");
}

function formatDate(date, inc_secs = true) {
  return {
    date: [date.getFullYear(), padTo2Digits(date.getMonth() + 1), padTo2Digits(date.getDate())].join("-"),
    time:
      [padTo2Digits(date.getHours()), padTo2Digits(date.getMinutes())].join(":") +
      (inc_secs ? ":" + padTo2Digits(date.getSeconds()) : ""),
  };
}

function formatTimeDuration(distance) {
  // Time calculations for days, hours, minutes and seconds
  // var days = Math.floor(distance / (1000 * 60 * 60 * 24));
  var hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  var minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
  var seconds = Math.floor((distance % (1000 * 60)) / 1000);
  return [padTo2Digits(hours), padTo2Digits(minutes), padTo2Digits(seconds)].join(":");
  //   return hours + "h " + minutes + "m " + seconds + "s ";
}

function formatRunningTimerPadded(date) {
  return formatDate(date, true).time;
}

function throttle(func, wait = 250) {
  let isWaiting = false;
  return function executedFunction(...args) {
    if (!isWaiting) {
      func.apply(this, args);
      isWaiting = true;
      setTimeout(() => {
        isWaiting = false;
        func.apply(this, args);
      }, wait);
    }
  };
}

//#endregion

/*
START
RACKS OFF
RACKS IN
*/

let DOMRefs = {
  popup: {
    wrapper: "#popup-wrapper",
    content: "#popup-content",
    inlineScrollbar: "#inline-scrollbar",
  },
  offcanvas: {
    sessionList: "#sessionList",
    btnCopyJSON: "#copyJSON",
  },
  timer: {
    chkTimer: "#playing-master",
    runningTimerLabel: "#runningTimerLabel",
    start: "#runningStartTime",
    end: "#runningEndTime",
  },
  form: {
    projSelect: "#timeProject",
    projSelectLbl: "#lblcurProj",
    projTxtInput: "input#newProjectInput",
    projTxtInputLbl: "#lblnewProj",
    projAddBtn: "#addProjectBtn",
    date: "#timeDate",
    start: "#timeStart",
    end: "#timeEnd",
    notes: "#timeNotes",
    submit: "#submitTime",
  },
};

function resolveRefs(obj) {
  for (const key in obj) {
    const val = obj[key];
    if (typeof val === "string") {
      obj[key] = document.querySelector(val);
    } else if (val && typeof val === "object") {
      resolveRefs(val);
    }
  }
}
let trackingIntervId = null;
let currentTimer = null;

function init() {
  console.log("init");
  resolveRefs(DOMRefs);

  const resizeObserver = new ResizeObserver((entries) => {
    onResize();
  });
  resizeObserver.observe(DOMRefs.popup.content);

  DOMRefs.popup.wrapper.addEventListener("scroll", updateScrollbar); // Throttled to just above 62.5 updates/s;
  updateScrollbar();

  /*
   *	BUTTON CLICK EVENTS
   */

  // Timer Play Button
  DOMRefs.timer.chkTimer.addEventListener("change", (event) => {
    let projName = DOMRefs.form.projSelect.value;
    let projNotes = DOMRefs.form.notes.value;
    let nowStarting = event.currentTarget.checked;
    browser.runtime
      .sendMessage({ type: "setTimerRunning", data: { project: projName, notes: projNotes, starting: nowStarting } })
      .then(readStorage, onError);
  });

  // add project + turns to > and pressing that will add txt <input> as <option> in project <select>
  DOMRefs.form.projAddBtn.onclick = () => {
    let toggle_or_submit = DOMRefs.form.projAddBtn.getAttribute("aria-pressed") == "true";
    DOMRefs.form.projAddBtn.textContent = toggle_or_submit ? ">" : "+";
    if (!toggle_or_submit) {
      // submitted by > press
      let newProj = DOMRefs.form.projTxtInput.value;
      if (typeof newProj === "string" && newProj != "") {
        // add <option>
        let newOpt = document.createElement("option");
        newOpt.textContent = newProj;
        DOMRefs.form.projSelect.append(newOpt);
        newOpt.selected = true;
      }
    }
    DOMRefs.form.projSelect.classList.toggle("hidden");
    DOMRefs.form.projSelectLbl.classList.toggle("hidden");
    DOMRefs.form.projTxtInput.classList.toggle("hidden");
    DOMRefs.form.projTxtInputLbl.classList.toggle("hidden");
  };

  DOMRefs.offcanvas.btnCopyJSON.onclick = () => {
    browser.storage.local.get().then((storage) => {
      if (storage.sessions) {
        navigator.clipboard.writeText(JSON.stringify(storage.sessions));
      }
    });
  };

  DOMRefs.form.submit.onclick = () => {
    const projName = DOMRefs.form.projSelect.value;
    const projNotes = DOMRefs.form.notes.value;
    const startDate = DOMRefs.form.date.datepicker.getDate();
    const startTime = DOMRefs.form.start.timepicker.getTime();
    const endTime = DOMRefs.form.end.timepicker.getTime();
    const data = { project: projName, notes: projNotes, date: startDate, start: startTime, end: endTime };
    browser.runtime.sendMessage({ type: "submitSession", data }).then(readStorage, onError);
  };

  /*
   *	Date & Time pickers (html5 picker inputs wont open on ff)
   */
  const datepicker = new Datepicker(DOMRefs.form.date, {
    buttonClass: "btn",
    autohide: true,
  });

  var args = {
    format: !use24HourFormat,
    // minTime: "2:00 am",
    // maxTime: "1:00 pm",
    meridiem: !use24HourFormat,
  };
  new timepicker(DOMRefs.form.start, args);
  new timepicker(DOMRefs.form.end, args);
  //   tpicker.updateSettings({ minTime: "2:00 am" });
  //   document.querySelector("#collapseAll").onclick = () => {
  //     document.querySelectorAll("#seshList details").forEach((element) => {
  //       element.open = false;
  //     });
  //   };

  readStorage();
}
init();

function readStorage(resp) {
  console.log(resp);
  const getPromise = browser.storage.local.get();
  getPromise.then(handleStorageOnStartup, onError);
}

function handleStorageOnStartup(resp) {
  return new Promise(function (resolve, reject) {
    console.log(resp);
    currentTimer = resp.current;
    if (currentTimer) {
      DOMRefs.form.projSelect.innerHTML = "";
      for (const page in resp.sessions) {
        if (page === "Unnamed Project") {
          continue;
        }
        const newOpt = document.createElement("option");
        newOpt.textContent = page;
        DOMRefs.form.projSelect.append(newOpt);
      }
      // DOMRefs.form.date.disabled = DOMRefs.form.start.disabled = DOMRefs.form.end.disabled =
      DOMRefs.timer.chkTimer.checked = currentTimer.timerRunning;

      if (currentTimer.timerRunning) {
        let starting_time = formatDate(new Date(currentTimer.startDate * 1000), false);
        //   DOMRefs.form.date.value = starting_time.date;
        DOMRefs.timer.start.value = starting_time.time;
        DOMRefs.timer.end.value = formatDate(new Date(), false).time;

        if (!trackingIntervId) {
          updateRunningTimer();
          trackingIntervId = setInterval(updateRunningTimer, 1000);
        }
      } else if (trackingIntervId) {
        clearInterval(trackingIntervId);
        trackingIntervId = null;
      }
    }
    generateSessionList(resp.sessions, resp.onlyNewSesh);
    console.log("DONE Handle");
    resolve("OK");
  });
}

function onError(error) {
  console.log(`Error: ${error}`);
}

function onResize(e) {
  const scrollRatio = DOMRefs.popup.wrapper.clientHeight / DOMRefs.popup.wrapper.scrollHeight;
  console.log("resize");
  if (scrollRatio >= 1) {
    DOMRefs.popup.inlineScrollbar.classList.add("hidden");
  } else {
    DOMRefs.popup.inlineScrollbar.classList.remove("hidden");
    updateScrollbar();
  }
}

function updateScrollbar(e) {
  const visHeight = DOMRefs.popup.wrapper.clientHeight;
  const totalHeight = DOMRefs.popup.wrapper.scrollHeight;
  const scrolledFromTop = Math.round(DOMRefs.popup.wrapper.scrollTop);
  const scrollRatio = visHeight / totalHeight;
  // console.log(scrollRatio);
  DOMRefs.popup.inlineScrollbar.style.height = Math.max(scrollRatio * 100, 10) + "%";
  DOMRefs.popup.inlineScrollbar.style.top = (scrolledFromTop / totalHeight) * 100 + "%";
  // const pixelsToScroll = totalHeight - visHeight;
  // const scrollPercent = (scrolledFromTop / pixelsToScroll) * 100;
  // raf(function() {
  //   // Hide scrollbar if no scrolling is possible
  //   if(_this.scrollRatio >= 1) {
  //     _this.bar.classList.add('ss-hidden')
  //   } else {
  //     _this.bar.classList.remove('ss-hidden')
  //     _this.bar.style.cssText = 'height:' + Math.max(_this.scrollRatio * 100, 10) + '%; top:' + (_this.el.scrollTop / totalHeight ) * 100 + '%;right:' + right + 'px;';
  //   }
}

function generateAccordion(title, content, idx, session_reference, isProject) {
  let acc_id = `accordion${idx}`;
  let coll_id = `collapse${idx}`;
  let content_bg = isProject ? "dark" : "body-secondary";
  let deleteProjBtn = isProject
    ? `<a class="deleteProj ms-auto" data-bs-toggle="modal" data-bs-target="#staticBackdrop" data-project-to-delete="">
		<img src="../icons/trash-fill.svg" alt="Delete Session" />
	  </a>`
    : "";

  let ret = document.createElement("div");
  ret.classList.add("accordion", "accordion-flush");
  ret.id = acc_id;
  ret.innerHTML = `
  <div class="accordion-item">
    <h2 class="accordion-header">
      <button class="accordion-button collapsed" type="button" data-session-reference="${session_reference}" data-bs-toggle="collapse" data-bs-target="#${coll_id}" aria-expanded="false" aria-controls="${coll_id}">
        ${title}
		${deleteProjBtn}
	  </button>
    </h2>
    <div id="${coll_id}" class="text-light bg-${content_bg} accordion-collapse collapse" data-bs-parent="#${acc_id}">
      <div class="accordion-body">
       ${content}
      </div>
    </div>`;
  return ret;
}

function generateSessionList(sessions, append = false) {
  if (!append) {
    DOMRefs.offcanvas.sessionList.innerHTML = "";
  }
  const idx_counter = {
    // auto incrementing counter for ids in html
    _internal_counter: 0,
    get counter() {
      this._internal_counter += 1;
      return this._internal_counter;
    },
  };
  for (const cur_project in sessions) {
    let projectCategory = generateAccordion(cur_project, "", idx_counter.counter, cur_project, false);
    let projectContent = projectCategory.querySelector(".accordion-body");
    for (const cur_session in sessions[cur_project]) {
      let startDate = new Date(cur_session * 1000);
      let endDate = new Date(sessions[cur_project][cur_session].endDate * 1000);
      let projNotes = sessions[cur_project][cur_session].name || "No session Notes.";

      let timeRangeStr = startDate.toLocaleDateString() + " <br /> ";
      timeRangeStr += startDate.toLocaleTimeString() + " - " + endDate.toLocaleTimeString();

      let sessionTitleHTML = startDate.toLocaleDateString() + " - " + startDate.toLocaleTimeString();
      sessionTitleHTML += " <br />" + formatTimeDuration(endDate.getTime() - startDate.getTime());
      projectContent.append(
        generateAccordion(sessionTitleHTML, timeRangeStr + "<br />" + projNotes, idx_counter.counter, cur_session, true)
      );
    }
    DOMRefs.offcanvas.sessionList.append(projectCategory);
  }
  // Hook up delete Buttons
  document.querySelectorAll(".deleteProj").forEach((delBtn) => {
    delBtn.onclick = (delBtnEvent) => {
      document.querySelector("#confirmDeleteBtn").onclick = () => {
        requestSessionDelete(delBtnEvent);
      };
    };
  });
}

function requestSessionDelete(e) {
  // we need to determine project name and startTime as thats how its saved in storage
  let sessionStartTime = e.target.parentNode.parentNode.getAttribute("data-session-reference");
  let closestCollapse = e.target.closest(".collapse");
  if (sessionStartTime && closestCollapse) {
    let projReferenceBtn = document.querySelector(`button[data-bs-target="#${closestCollapse.id}"]`);
    if (projReferenceBtn) {
      //   let openCollapses = document.querySelectorAll("#sessionList .collapse.show");
      //   openCollapses.forEach((col) => {
      // 	col.getAttribute("data-bs-target")
      //   });
      let projName = projReferenceBtn.getAttribute("data-session-reference");
      const scrollTopPreDelete = document.querySelector(".offcanvas-body").scrollTop;
      browser.runtime
        .sendMessage({
          type: "deleteSession",
          data: { project: projName, startTime: sessionStartTime },
        })
        .then(() => {
          browser.storage.local
            .get()
            .then(handleStorageOnStartup)
            .then(() => {
              console.log("Looking for " + `button[data-session-reference="${projName}"]`);
              let projBtn = document.querySelector(`button[data-session-reference="${projName}"]`);
              let projCollapseSel = projBtn.getAttribute("data-bs-target");
              let projCollapse = document.querySelector(projCollapseSel);
              console.log(projCollapse);
              projBtn.classList.remove("collapsed");
              projCollapse.classList.add("show");
              document.querySelector(".offcanvas-body").scrollTop = scrollTopPreDelete;
            });
        });
    }
  }
}

function updateRunningTimer() {
  const now = new Date();
  if (timePickers.end.getTime().getMinutes() != now.getMinutes()) {
    updateRunningEndTime();
  }
  DOMRefs.timer.runningTimerLabel.textContent = formatTimeDuration(
    now.getTime() - new Date(currentTimer.startDate * 1000).getTime()
  );
}

function updateRunningEndTime() {
  DOMRefs.timer.end.value = formatDate(new Date(), false).time;
}
