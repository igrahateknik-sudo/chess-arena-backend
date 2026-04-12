# Config Google Cloud Provider
provider "google" {
  project = "project-61a3af43-1cbd-438e-950"
  region  = "asia-southeast2"
}

# 1. Artifact Registry (Tempat simpan Docker Image)
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

# 3. Serverless VPC Connector (Agar Cloud Run bisa akses Redis Private)
resource "google_vpc_access_connector" "connector" {
  name          = "chess-vpc-conn"
  region        = "asia-southeast2"
  ip_cidr_range = "10.8.0.0/28"
  network       = google_compute_network.vpc_network.name
  min_instances = 2
  max_instances = 3
}

# 4. Cloud SQL (PostgreSQL)
resource "google_sql_database_instance" "postgres" {
  name             = "chess-db-instance"
  database_version = "POSTGRES_15"
  region           = "asia-southeast2"
  settings {
    tier = "db-f1-micro"
    ip_configuration { 
      ipv4_enabled = true 
    }
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
  ingress  = "INGRESS_TRAFFIC_ALL" # Ubah sementara agar bisa diakses langsung untuk testing

  template {
    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "ALL_TRAFFIC"
    }
    containers {
      image = "asia-southeast2-docker.pkg.dev/project-61a3af43-1cbd-438e-950/chess-arena-repo/chess-backend:latest"
      ports { container_port = 8080 }
      
      env {
        name  = "DATABASE_URL"
        value = "postgresql://postgres:ChessArena_Secret_2026_Secure@127.0.0.1:5432/postgres?host=/cloudsql/project-61a3af43-1cbd-438e-950:asia-southeast2:chess-db-instance"
      }
      env {
        name  = "REDIS_URL"
        value = "redis://${google_redis_instance.cache.host}:6379"
      }
      env {
        name  = "JWT_SECRET"
        value = "SUPER_SECRET_KEY_CHESS_ARENA_2026"
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "ALLOWED_ORIGINS"
        value = "https://chess-arena.app,https://www.chess-arena.app"
      }
    }
  }
}

# IAM: Izinkan akses publik (Unauthenticated) ke Backend
resource "google_cloud_run_v2_service_iam_member" "noauth" {
  location = google_cloud_run_v2_service.backend.location
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Outputs
output "backend_url" {
  value = google_cloud_run_v2_service.backend.uri
}
