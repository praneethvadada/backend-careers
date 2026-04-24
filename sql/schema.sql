CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(120) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  type VARCHAR(40) NOT NULL,
  category VARCHAR(40) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'open',
  location VARCHAR(255) NOT NULL,
  duration VARCHAR(120) NOT NULL,
  start_date VARCHAR(120) NOT NULL,
  end_date VARCHAR(120) NOT NULL,
  salary VARCHAR(120) NULL,
  description TEXT NOT NULL,
  eligibility TEXT NOT NULL,
  responsibilities_json JSON NOT NULL,
  required_skills_json JSON NOT NULL,
  requirements_json JSON NOT NULL,
  other_requirements_json JSON NOT NULL,
  perks_json JSON NOT NULL,
  custom_fields_json JSON NULL,
  picker_options_json JSON NULL,
  posted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS applications (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  job_id VARCHAR(120) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  city VARCHAR(120) NULL,
  resume_link TEXT NULL,
  resume_name VARCHAR(255) NULL,
  application_summary LONGTEXT NULL,
  additional_info LONGTEXT NULL,
  education_json JSON NULL,
  experience_json JSON NULL,
  custom_answers_json JSON NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'submitted',
  status_note TEXT NULL,
  last_status_email_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_applications_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS application_status_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  application_id BIGINT NOT NULL,
  previous_status VARCHAR(40) NOT NULL,
  next_status VARCHAR(40) NOT NULL,
  status_note TEXT NULL,
  changed_by VARCHAR(120) NOT NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_status_events_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);
