# Config Google Cloud Provider
provider "google" {
  project = "project-61a3af43-1cbd-438e-950"
  region  = "asia-southeast2"
}

# 1. Artifact Registry
resource "google_artifact_registry_repository" "chess_repo" {
  location      = "asia-southeast2"
  repository_id = "chess-arena-repo"
  format        = "DOCKER"
}

# 2. VPC Network
resource "google_compute_network" "vpc_network" {
  name                    = "chess-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "vpc_subnet" {
  name          = "chess-subnet"
  ip_cidr_range = "10.0.0.0/24"
  network       = google_compute_network.vpc_network.id
  region        = "asia-southeast2"
}

# 4. Cloud SQL (PostgreSQL)
resource "google_sql_database_instance" "postgres" {
  name             = "chess-db-instance"
  database_version = "POSTGRES_15"
  region           = "asia-southeast2"
  settings {
    tier = "db-f1-micro"
    ip_configuration { ipv4_enabled = true }
  }
  deletion_protection = false
}

# 5. Memorystore (Redis)
resource "google_redis_instance" "cache" {
  name           = "chess-redis"
  tier           = "BASIC"
  memory_size_gb = 1
  region         = "asia-southeast2"
  authorized_network = google_compute_network.vpc_network.id
  connect_mode = "DIRECT_PEERING"
}

# 6. Backend Service (Cloud Run)
resource "google_cloud_run_v2_service" "backend" {
  name     = "chess-backend"
  location = "asia-southeast2"
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" # Hanya lewat LB agar aman

  template {
    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc_network.name
        subnetwork = google_compute_subnetwork.vpc_subnet.name
      }
      egress = "ALL_TRAFFIC"
    }
    containers {
      image = "asia-southeast2-docker.pkg.dev/project-61a3af43-1cbd-438e-950/chess-arena-repo/chess-backend:latest"
      ports { container_port = 8080 }
      env {
        name  = "DATABASE_URL"
        value = "postgresql://postgres:PASSWORD@${google_sql_database_instance.postgres.ip_address[0].ip_address}:5432/postgres"
      }
      env {
        name  = "REDIS_URL"
        value = "redis://${google_redis_instance.cache.host}:6379"
      }
    }
  }
}

# 7. Frontend Service (Cloud Run)
resource "google_cloud_run_v2_service" "frontend" {
  name     = "chess-frontend"
  location = "asia-southeast2"
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" # Hanya lewat LB agar aman

  template {
    containers {
      image = "asia-southeast2-docker.pkg.dev/project-61a3af43-1cbd-438e-950/chess-arena-repo/chess-frontend:latest"
      ports { container_port = 8080 }
      env {
        name  = "NEXT_PUBLIC_BACKEND_URL"
        value = "https://api.chess-arena.app"
      }
    }
  }
}

# ------------------------------------------------------------------------------
# GLOBAL LOAD BALANCER (THE "PRO" WAY)
# ------------------------------------------------------------------------------

# 1. Reserve Static IP
resource "google_compute_global_address" "lb_ip" {
  name = "chess-arena-lb-ip"
}

# 2. Serverless NEGs (Network Endpoint Groups)
resource "google_compute_region_network_endpoint_group" "backend_neg" {
  name                  = "chess-backend-neg"
  region                = "asia-southeast2"
  network_endpoint_type = "SERVERLESS"
  cloud_run { service = google_cloud_run_v2_service.backend.name }
}

resource "google_compute_region_network_endpoint_group" "frontend_neg" {
  name                  = "chess-frontend-neg"
  region                = "asia-southeast2"
  network_endpoint_type = "SERVERLESS"
  cloud_run { service = google_cloud_run_v2_service.frontend.name }
}

# 3. Backend Services for Load Balancer
resource "google_compute_backend_service" "backend_lb_service" {
  name      = "backend-lb-service"
  protocol  = "HTTPS"
  port_name = "http"
  timeout_sec = 30

  backend { group = google_compute_region_network_endpoint_group.backend_neg.id }
}

resource "google_compute_backend_service" "frontend_lb_service" {
  name      = "frontend-lb-service"
  protocol  = "HTTPS"
  port_name = "http"
  timeout_sec = 30

  backend { group = google_compute_region_network_endpoint_group.frontend_neg.id }
}

# 4. URL Map (Routing: api.* to backend, others to frontend)
resource "google_compute_url_map" "url_map" {
  name            = "chess-arena-url-map"
  default_service = google_compute_backend_service.frontend_lb_service.id

  host_rule {
    hosts        = ["api.chess-arena.app"]
    path_matcher = "api-matcher"
  }

  path_matcher {
    name            = "api-matcher"
    default_service = google_compute_backend_service.backend_lb_service.id
  }
}

# 5. SSL Certificate (Google Managed)
resource "google_compute_managed_ssl_certificate" "ssl_cert" {
  name = "chess-arena-ssl"
  managed {
    domains = ["www.chess-arena.app", "api.chess-arena.app"]
  }
}

# 6. Target HTTPS Proxy
resource "google_compute_target_https_proxy" "https_proxy" {
  name             = "chess-arena-https-proxy"
  url_map          = google_compute_url_map.url_map.id
  ssl_certificates = [google_compute_managed_ssl_certificate.ssl_cert.id]
}

# 7. Global Forwarding Rule (Koneksi IP ke Load Balancer)
resource "google_compute_global_forwarding_rule" "https_forwarding_rule" {
  name                  = "chess-arena-https-rule"
  target                = google_compute_target_https_proxy.https_proxy.id
  port_range            = "443"
  ip_address            = google_compute_global_address.lb_ip.address
  load_balancing_scheme = "EXTERNAL"
}

# Outputs
output "load_balancer_ip" {
  value = google_compute_global_address.lb_ip.address
}
