const fs = require('fs');
const cheerio = require('cheerio');

function processFile(file, keepTitles, keepStats, keepProfile) {
   if (!fs.existsSync(file)) {
      console.warn(`Warning: File ${file} not found. Skipping...`);
      return;
   }
   const html = fs.readFileSync(file, 'utf-8');
   const $ = cheerio.load(html);

   // Set all nav items active state
   $('.nav-item').removeClass('active');
   const filename = file.split('.')[0];
   $(`.nav-item[onclick*="${filename}"]`).addClass('active');

   $('.card').each((i, el) => {
      const title = $(el).find('.card-title').text().trim();
      if (title) {
         let shouldKeep = false;
         for (let keep of keepTitles) {
            if (title.includes(keep)) shouldKeep = true;
         }
         if (!shouldKeep) {
            $(el).remove();
         }
      }
   });

   if (!keepStats) {
      $('#statsGrid').remove();
   }

   if (!keepProfile) {
      $('#profileCard').remove();
   }

   // Clean up empty columns
   $('.left-col, .right-col').each((i, el) => {
      if ($(el).children().length === 0) {
         $(el).remove();
      }
   });

   // if main-grid is empty, remove it
   if ($('.main-grid').children().length === 0) {
      $('.main-grid').remove();
   }

   fs.writeFileSync(file, $.html());
}

processFile('schedule.html', ["Today's Appointments"], false, false);
processFile('attendance.html', ["Attendance", "Leave Requests"], false, true);

console.log("Files processed successfully");
