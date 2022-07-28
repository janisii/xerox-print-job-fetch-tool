const puppeteer = require("puppeteer");
const xmlParser = require("xml2json");

const { fetchLastJobId, pushJobsToServer } = require("./requests");

/**
 * Open page by selector
 * @param {*} page
 * @param {*} selector
 */
const openPage = (page, selector) =>
  new Promise(async resolve => {
    await page.waitForSelector(selector);
    await Promise.all([
      page.click(selector),
      page
        .waitForNavigation({ waitUntil: "networkidle0", timeout: 7000 })
        .catch(() =>
          console.log(`Waiting for navigation after ${selector} clicked.`)
        ),
    ]);
    resolve(`Page opened by selector ${selector}.`);
  });

/**
 * Login to admin account
 * @param {*} page
 * @param {*} adminUser
 * @param {*} adminPassword
 */
const login = (page, adminUser, adminPassword) =>
  new Promise(async resolve => {
    await Promise.all([page.click("button#globalnavButton")]);
    await page.waitForSelector("section.xux-contactsTable-section");

    await page.evaluate(adminUserName => {
      let adminAccountLabelSpan;

      document
        .querySelectorAll(".xux-contactsTable-displayName")
        .forEach(acc => {
          if (acc.textContent === adminUserName) {
            adminAccountLabelSpan = acc;
          }
        });

      const adminAccountElement = adminAccountLabelSpan
        ? adminAccountLabelSpan.parentElement.parentElement.parentElement
        : null;

      // click on element with event dispatch
      adminAccountElement.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
    }, adminUser);

    // Wait for password input field
    await page.waitForSelector("#loginWithPswInput");

    // Fill out loginForm with credentials
    await page.type("#loginWithPswInput", adminPassword);

    // Submit login
    await openPage(page, "#loginWithPswOK");

    resolve("User logged in.");
  });

/**
 * Fetch all print jobs from Xerox device in XML format
 * @param {*} page
 * @param {*} host
 * @param {*} lastJobId
 */
const fetchJobsListXML = (page, host, lastJobId) =>
  new Promise(async resolve => {
    const jobsXML = await page.evaluate(
      async ({ host: hostAddr, lastJobId: lastJob }) => {
        const fetchJobs = async (startFromJobListId = null, outputXML = "") => {
          let startFromJobListIdXML = "";

          if (startFromJobListId) {
            startFromJobListIdXML = `<djob:StartJobID includes="false">${startFromJobListId}</djob:StartJobID>`;
          }

          const res = await fetch(`${hostAddr}/ssm/Management/Job/Device`, {
            credentials: "include",
            headers: {
              accept: "text/plain, */*; q=0.01",
              "accept-language": "en-US,en;q=0.9",
              "content-type": "text/xml; charset=UTF-8",
              "sec-fetch-mode": "cors",
              "sec-fetch-site": "same-origin",
              soapaction:
                '"http://www.fujixerox.co.jp/2014/08/ssm/management/job/device#GetDeviceJobList"',
              "x-requested-with": "XMLHttpRequest",
            },
            body: `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Header><msg:MessageInformation xmlns:msg="http://www.fujixerox.co.jp/2014/08/ssm/management/message"><msg:MessageExchangeType>RequestResponse</msg:MessageExchangeType><msg:MessageType>Request</msg:MessageType><msg:Action>http://www.fujixerox.co.jp/2014/08/ssm/management/job/device#GetDeviceJobList</msg:Action><msg:From><msg:Address>http://www.fujixerox.co.jp/2014/08/ssm/management/soap/epr/client</msg:Address><msg:ReferenceParameters/></msg:From></msg:MessageInformation></soap:Header><soap:Body><djob:GetDeviceJobList xmlns:djob="http://www.fujixerox.co.jp/2014/08/ssm/management/job/device"><djob:Mode>Completed</djob:Mode><djob:Scope>${startFromJobListIdXML}<djob:Limit>25</djob:Limit></djob:Scope><djob:Sort><djob:Order>Descending</djob:Order><djob:Key>COMPLETED</djob:Key></djob:Sort></djob:GetDeviceJobList></soap:Body></soap:Envelope>`,
            method: "POST",
            mode: "cors",
          });

          const xml = await res.text();

          const lastJobIdRegex = /<JobID.*>(.*)<\/JobID>/g;
          const lastJobIdXML = [...xml.matchAll(lastJobIdRegex)];

          const lastJobIdFromXML =
            lastJobIdXML[0] && lastJobIdXML[0][1] ? lastJobIdXML[0][1] : null;

          const jobsListRegex = /<Jobs>(.*)<\/Jobs>/g;
          const jobsListMatchRes = [...xml.matchAll(jobsListRegex)];

          /* eslint-disable no-param-reassign */
          outputXML +=
            jobsListMatchRes[0] && jobsListMatchRes[0][1]
              ? jobsListMatchRes[0][1]
              : null;
          /* eslint-enable no-param-reassign */

          // If not found lastJobId in the result XML, let's run fetchJobs with higher limit again
          if (!xml.includes(lastJob)) {
            return fetchJobs(lastJobIdFromXML, outputXML);
          }

          return outputXML;
        };

        return fetchJobs();
      },
      {
        host,
        lastJobId,
      }
    );
    return resolve(jobsXML);
  });

/**
 * Create new job list
 * @param {*} xml
 * @param {*} jobId
 * @param {*} name
 */
const prepareJobs = (xml, jobId, name) =>
  new Promise(async resolve => {
    const jobsFromXML = await xmlParser.toJson(xml, { object: true });

    const jobsList =
      jobsFromXML["env:Envelope"]["env:Body"].GetDeviceJobListResponse.Jobs.Job;

    const jobIdIndex = jobsList.findIndex(job => job.JobID === jobId);

    // Removing not needed information form job items
    const jobsCompressed = jobsList.slice(0, jobIdIndex).map(job => {
      let totalPages = 0;

      let userName = "guest";

      if (job.UserInformation.UserID.$t) {
        userName = job.UserInformation.UserID.$t.toLowerCase();
      }

      if (job.UserInformation.UserName.$t) {
        userName = job.UserInformation.UserName.$t.toLowerCase();
      }

      if (["admin", "janis", "ko", "report"].includes(userName)) {
        userName = "janis.itkacs";
      }

      if (job.JobTypeDetail !== "copy" && job.JobTypeDetail !== "print") {
        return null;
      }

      if (job.JobTypeDetail === "print") {
        const totalSentPages =
          job.ProgressInformation.FilingProgressInformation.Pages;
        const totalCopiesPages =
          job.ProgressInformation.PrintProgressInformation.Copies;
        totalPages =
          totalCopiesPages > totalSentPages ? totalCopiesPages : totalSentPages;
      }

      if (job.JobTypeDetail === "copy") {
        totalPages = job.ProgressInformation.PrintProgressInformation.Copies;
      }

      if (totalPages < 1) {
        return null;
      }

      return {
        device: name,
        jobId: job.JobID,
        jobType: job.JobTypeDetail || "copy",
        jobNumber: job.DocumentInformation.Number,
        jobUser: userName,
        jobTimeCompleted: job.TimeInformation.Completed,
        jobTotalPages: totalPages,
        jobTimestamp: new Date(job.TimeInformation.Completed).getTime(),
      };
    });

    return resolve(jobsCompressed.filter(item => item));
  });

/**
 * Fix XML document
 * @param {*} midXML
 */
const fixXMLJobList = data => {
  const startXML = `<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body xmlns:xsd="http://www.w3.org/2000/10/XMLSchema"><GetDeviceJobListResponse xmlns="http://www.fujixerox.co.jp/2014/08/ssm/management/job/device"><Jobs>`;
  const endXML = `</Jobs><Next>true</Next></GetDeviceJobListResponse></env:Body></env:Envelope>`;
  return `${startXML}${data}${endXML}`;
};

/**
 * Run puppeteer to do some stuff with Xerox device
 * @param {*} device
 */
const jobs = device => {
  const { name, host, user: adminUser, pass: adminPassword, jobId } = device;
  return new Promise(async (resolve, reject) => {
    const browser = await puppeteer.launch({
      headless: true,
      devtools: false,
      ignoreHTTPSErrors: true,
      args: ["--window-size=1800,800"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });

    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.142 Safari/537.36"
    );

    let connected = true;
    console.log(`Starting on ${name} ${host}...`);

    // Go to main home page
    await page
      .goto(`${host}`, {
        waitUntil: "networkidle0",
      })
      .catch(() => {
        connected = false;
      });

    if (!connected) {
      browser.close();
      return reject(new Error(`Could not connect to ${name} ${host}...`));
    }

    console.log(`Connecting to login procedure on ${name} ${host}...`);

    // Login with adminUser
    await login(page, adminUser, adminPassword);

    // Load lastJobId from app.ogressakumskoal.lv server
    const lastJobId = (await fetchLastJobId(name)) || jobId;

    // Get jobs list in XML
    const jobsXML = fixXMLJobList(
      await fetchJobsListXML(page, host, lastJobId)
    );

    // Convert jobs from XML to JSON format
    const jobsData = await prepareJobs(jobsXML, lastJobId, name);

    // Push data to app.ogressakumskoal.lv server
    await pushJobsToServer(jobsData);

    browser.close();
    resolve("Jobs imported.");
  });
};

module.exports = jobs;
