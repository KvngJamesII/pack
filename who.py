import requests
import re
import json
import time
import sys
from datetime import datetime
from bs4 import BeautifulSoup
import os

# ==================== CONFIGURATION ====================
BASE_URL = "http://185.2.83.39/ints"
LOGIN_URL = f"{BASE_URL}/login"
SIGNIN_URL = f"{BASE_URL}/signin"
RANGES_URL = f"{BASE_URL}/agent/res/data_smsranges.php"
MYNUMBERS_URL = f"{BASE_URL}/agent/res/data_smsnumbers.php"
REQUEST_URL = f"{BASE_URL}/agent/res/requestsmsnumberfinal.php"

USERNAME = "Desty_11"
PASSWORD = "Desty@11"
TARGET_COUNT = 500
BATCH_SIZE = 10
SESSION_CHECK_INTERVAL = 50
REQUEST_DELAY = 2
BATCH_DELAY = 3

# Timeouts
BASE_TIMEOUT = 15
TIMEOUT_PER_50_NUMBERS = 5

# PROGRESS TRACKING FILE
PROGRESS_FILE = "bot_progress.json"

# Headers
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 13; V2066 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.34 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "X-Requested-With": "com.xbrowser.play"
}

# Logging
def log_message(message):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] {message}")

def save_progress(current_batch, processed_ranges, stats):
    """Save progress to file"""
    progress = {
        "last_batch_number": current_batch,
        "processed_ranges": list(processed_ranges),
        "stats": stats,
        "last_saved": datetime.now().isoformat()
    }
    
    try:
        with open(PROGRESS_FILE, 'w') as f:
            json.dump(progress, f, indent=2)
    except Exception as e:
        log_message(f"FAILED to save progress: {e}")

def load_progress():
    """Load progress from file"""
    if not os.path.exists(PROGRESS_FILE):
        log_message("No previous progress found. Starting fresh.")
        return {
            "last_batch_number": 0,
            "processed_ranges": set(),
            "stats": {"successful": 0, "skipped": 0, "failed": 0}
        }
    
    try:
        with open(PROGRESS_FILE, 'r') as f:
            data = json.load(f)
        
        return {
            "last_batch_number": data.get("last_batch_number", 0),
            "processed_ranges": set(data.get("processed_ranges", [])),
            "stats": data.get("stats", {"successful": 0, "skipped": 0, "failed": 0})
        }
        
    except Exception as e:
        log_message(f"FAILED to load progress: {e}. Starting fresh.")
        return {
            "last_batch_number": 0,
            "processed_ranges": set(),
            "stats": {"successful": 0, "skipped": 0, "failed": 0}
        }

def solve_captcha(html_content):
    """Solve math captcha"""
    soup = BeautifulSoup(html_content, 'html.parser')
    captcha_input = soup.find('input', {'name': 'capt'})
    
    if not captcha_input:
        return None
    
    captcha_div = captcha_input.find_parent('div', class_='wrap-input100')
    if not captcha_div:
        return None
    
    captcha_text = captcha_div.get_text(strip=True)
    pattern = r"What is\s+(\d+)\s*([+\-*/])\s*(\d+)\s*=\s*\?"
    match = re.search(pattern, captcha_text, re.IGNORECASE)
    
    if match:
        num1, operator, num2 = int(match.group(1)), match.group(2), int(match.group(3))
        answer = {"+": num1 + num2, "-": num1 - num2, "*": num1 * num2, "/": num1 // num2}.get(operator)
        return str(answer) if answer is not None else None
    return None

def login():
    """Login and return session"""
    log_message("Starting login...")
    session = requests.Session()
    
    try:
        response = session.get(LOGIN_URL, headers=HEADERS, timeout=15)
        response.raise_for_status()
    except Exception as e:
        log_message(f"Failed to load login page: {e}")
        return None
    
    captcha = solve_captcha(response.text)
    if not captcha:
        log_message("Could not solve captcha")
        return None
    
    login_data = {
        "username": USERNAME,
        "password": PASSWORD,
        "capt": captcha
    }
    
    try:
        response = session.post(SIGNIN_URL, headers=HEADERS, data=login_data, 
                              allow_redirects=False, timeout=15)
        response.raise_for_status()
    except Exception as e:
        log_message(f"Login POST failed: {e}")
        return None
    
    if response.status_code != 302:
        log_message(f"Expected 302 redirect, got {response.status_code}")
        return None
    
    dashboard_url = f"{BASE_URL}/{response.headers['location']}"
    try:
        response = session.get(dashboard_url, headers=HEADERS, timeout=15)
        response.raise_for_status()
    except Exception as e:
        log_message(f"Failed to reach dashboard: {e}")
        return None
    
    log_message("Login successful")
    return session

def get_batch(session, start, length):
    """Fetch one batch of ranges"""
    params = {
        "sEcho": "1",
        "iColumns": "10",
        "iDisplayStart": str(start),
        "iDisplayLength": str(length),
        "mDataProp_0": "0",
        "bSortable_0": "true",
        "iSortCol_0": "0",
        "sSortDir_0": "asc",
        "iSortingCols": "1"
    }
    
    ajax_headers = {
        **HEADERS,
        "X-Requested-With": "XMLHttpRequest",
        "Referer": f"{BASE_URL}/agent/SMSRanges",
        "Accept": "application/json, text/javascript, */*; q=0.01"
    }
    
    try:
        response = session.get(RANGES_URL, headers=ajax_headers, params=params, timeout=30)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        log_message(f"Failed to fetch batch {start}-{start+length}: {e}")
        return None

def extract_ranges(data):
    """Extract range info from DataTables response"""
    ranges = []
    for row in data.get("aaData", []):
        if len(row) < 10:
            continue
        
        action_html = row[9]
        range_id = None
        
        if action_html and 'info=' in action_html:
            soup = BeautifulSoup(action_html, 'html.parser')
            btn = soup.find('a', id='request')
            if btn and btn.has_attr('info'):
                range_id = btn['info']
        
        if range_id:
            ranges.append({
                "id": range_id,
                "name": row[0] or row[1],
                "prefix": row[1]
            })
    
    return ranges

def get_existing_count(session, range_id):
    """Get count of existing numbers for a range"""
    params = {
        "frange": range_id,
        "fclient": "",
        "sEcho": "1",
        "iDisplayStart": "0",
        "iDisplayLength": "1",
        "mDataProp_0": "0",
        "bSortable_0": "false"
    }
    
    ajax_headers = {
        **HEADERS,
        "X-Requested-With": "XMLHttpRequest",
        "Referer": f"{BASE_URL}/agent/MySMSNumbers",
        "Accept": "application/json, text/javascript, */*; q=0.01"
    }
    
    try:
        response = session.get(MYNUMBERS_URL, headers=ajax_headers, params=params, timeout=15)
        response.raise_for_status()
        data = response.json()
        count = int(data.get("iTotalDisplayRecords", 0))
        log_message(f"  Existing numbers: {count}")
        return count
    except Exception as e:
        log_error(range_id, f"Failed to get count: {e}")
        return -1

def request_numbers(session, range_id, quantity):
    """Request numbers with dynamic timeout and verification"""
    ajax_headers = {
        "User-Agent": HEADERS["User-Agent"],
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Origin": "http://185.2.83.39",
        "Referer": "http://185.2.83.39/ints/agent/SMSRanges",
        "Connection": "keep-alive"
    }
    
    request_data = {
        "rid": range_id,
        "payterm": "8",
        "qty": str(quantity)
    }
    
    dynamic_timeout = BASE_TIMEOUT + ((quantity // 50) * TIMEOUT_PER_50_NUMBERS)
    
    try:
        log_message(f"  Sending request (timeout: {dynamic_timeout}s)...")
        response = session.post(REQUEST_URL, headers=ajax_headers, data=request_data, timeout=dynamic_timeout)
        response.raise_for_status()
        
        response_text = response.text.lower()
        if "successfully" in response_text or "allocated" in response_text:
            log_message("  SUCCESS!")
            return True
        elif "more then 500" in response_text:
            log_message("  ERROR: Server rejected (over 500 limit)")
            return False
        else:
            log_message(f"  FAILED: {response.text[:150]}")
            return False
            
    except requests.exceptions.Timeout:
        log_message(f"  TIMEOUT after {dynamic_timeout}s")
        log_message("  Waiting 10s then verifying...")
        time.sleep(10)
        
        existing_after = get_existing_count(session, range_id)
        if existing_after >= TARGET_COUNT:
            log_message("  VERIFIED: Numbers allocated despite timeout!")
            return True
        else:
            log_message(f"  VERIFIED: Not allocated (still need {TARGET_COUNT - existing_after})")
            return False
            
    except Exception as e:
        log_error(range_id, f"Request failed: {e}")
        return False

def process_range(session, range_info):
    """Process a single range with adaptive quantity reduction"""
    range_id = range_info["id"]
    range_name = range_info["name"]
    
    log_message(f"Processing: {range_name} (ID: {range_id})")
    
    existing = get_existing_count(session, range_id)
    if existing == -1:
        log_message("  Failed to get count, skipping")
        return "error"
    
    if existing >= TARGET_COUNT:
        log_message(f"  Already has {existing}/{TARGET_COUNT} - SKIPPING")
        return "skipped"
    
    # CRITICAL: Cap at 499 to avoid "over 500" server error
    raw_needed = TARGET_COUNT - existing
    needed = min(raw_needed, 499)
    
    if needed <= 0:
        log_message(f"  Already has sufficient numbers - SKIPPING")
        return "skipped"
    
    log_message(f"  Existing: {existing} | Requesting: {needed}")
    
    # Try requesting with up to 5 reduction attempts
    for attempt in range(5):
        if attempt > 0:
            # Reduce by 10 each retry
            needed = max(0, needed - 10)
            log_message(f"  Reduction attempt {attempt + 1}/5 - trying {needed} numbers")
        
        if needed <= 0:
            log_message("  Cannot request zero numbers")
            return "skipped"
        
        if request_numbers(session, range_id, needed):
            log_message(f"  SUCCESS with {needed} numbers!")
            return True
    
    log_message("  FAILED after all reduction attempts")
    return False

def check_session_health(session):
    """Verify session is still active"""
    try:
        response = session.get(f"{BASE_URL}/agent/", headers=HEADERS, timeout=10)
        return response.status_code == 200 and "login" not in response.url.lower()
    except:
        return False

def main():
    """Main unstoppable bot loop with resume capability"""
    log_message("="*60)
    log_message("UNSTOPPABLE SMS BOT - WITH RESUME CAPABILITY")
    log_message("="*60)
    
    # Load previous progress
    progress = load_progress()
    last_batch = progress["last_batch_number"]
    processed_ranges = progress["processed_ranges"]
    stats = progress["stats"]
    
    session = None
    successful = stats["successful"]
    failed = stats["failed"]
    skipped = stats["skipped"]
    batch_num = last_batch
    total_ranges_processed = len(processed_ranges)
    
    # Initial login
    session = login()
    if not session:
        log_message("CRITICAL: Login failed, exiting")
        sys.exit(1)
    
    # Get total range count
    initial_data = get_batch(session, 0, 1)
    if not initial_data:
        log_message("CRITICAL: Could not get total range count")
        sys.exit(1)
    
    total_ranges = int(initial_data.get("iTotalDisplayRecords", 0))
    log_message(f"Total ranges to process: {total_ranges}")
    log_message(f"Resuming from batch: #{last_batch + 1}")
    log_message(f"Already processed: {len(processed_ranges)} ranges")
    log_message("="*60)
    
    # If resuming, wait for user to cancel if needed
    if last_batch > 0:
        log_message("Resuming in 5 seconds (Ctrl+C to cancel)...")
        time.sleep(5)
    
    # Main batch loop
    while True:
        batch_num += 1
        start_index = (batch_num - 1) * BATCH_SIZE
        
        if start_index >= total_ranges:
            break
        
        log_message("-"*50)
        log_message(f"Loading Batch #{batch_num} (ranges {start_index + 1}-{min(start_index + BATCH_SIZE, total_ranges)})")
        
        # Load batch with retry
        data = None
        for attempt in range(3):
            data = get_batch(session, start_index, BATCH_SIZE)
            if data:
                break
            log_message(f"  Retry {attempt + 1}/3 loading batch...")
            time.sleep(5 ** attempt)
        
        if not data:
            log_message("Failed to load batch after 3 attempts, skipping...")
            continue
        
        ranges = extract_ranges(data)
        
        if not ranges:
            log_message("No valid ranges in batch, skipping...")
            time.sleep(BATCH_DELAY)
            continue
        
        # Process each range in batch
        for range_info in ranges:
            # Skip already processed ranges
            if range_info["id"] in processed_ranges:
                log_message(f"SKIPPING {range_info['name']} - already processed")
                continue
            
            try:
                result = process_range(session, range_info)
                
                # Mark as processed if successful or skipped
                if result is True or result == "skipped":
                    processed_ranges.add(range_info["id"])
                    
                    # Update stats
                    if result is True:
                        stats["successful"] += 1
                    elif result == "skipped":
                        stats["skipped"] += 1
                    
                    # Save progress after each range
                    save_progress(batch_num, processed_ranges, stats)
                
                elif result == "error":
                    stats["failed"] += 1
                
                total_ranges_processed += 1
                
                # Progress update
                if total_ranges_processed % 10 == 0:
                    progress = (total_ranges_processed / total_ranges) * 100
                    log_message(f"PROGRESS: {total_ranges_processed}/{total_ranges} ({progress:.1f}%)")
                
                time.sleep(REQUEST_DELAY)
                
            except KeyboardInterrupt:
                log_message("USER STOPPED BOT (Ctrl+C)")
                log_message(f"Progress: {total_ranges_processed}/{total_ranges} ranges completed")
                log_message(f"Last batch processed: #{batch_num}")
                save_progress(batch_num, processed_ranges, stats)
                sys.exit(0)
            
            except Exception as e:
                log_error(range_info["id"], f"Unexpected error: {e}")
                stats["failed"] += 1
        
        # Session health check
        if batch_num % SESSION_CHECK_INTERVAL == 0:
            log_message("Checking session health...")
            if not check_session_health(session):
                log_message("Session expired! Attempting re-login...")
                session = login()
                if not session:
                    log_message("CRITICAL: Re-login failed. Cannot continue.")
                    break
        
        # Batch complete
        log_message(f"Batch {batch_num} complete")
        log_message(f"Batch stats: {successful} successful, {skipped} skipped, {failed} failed")
        log_message(f"Waiting {BATCH_DELAY}s before next batch...")
        time.sleep(BATCH_DELAY)
    
    # Final summary
    log_message("="*60)
    log_message("BOT COMPLETED!")
    log_message("="*60)
    log_message(f"Total processed: {total_ranges_processed}/{total_ranges}")
    log_message(f"Successful: {successful}")
    log_message(f"Skipped: {skipped}")
    log_message(f"Failed: {failed}")
    
    # Clean up progress file
    if total_ranges_processed >= total_ranges * 0.95:
        log_message("Bot nearly complete. Removing progress file...")
        try:
            os.remove(PROGRESS_FILE)
        except:
            pass
    
    log_message("="*60)

if __name__ == "__main__":
    main()