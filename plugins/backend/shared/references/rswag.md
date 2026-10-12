# rswag / Swagger

Paths from config: `api.swagger.specs_path/<version>/<resource>_spec.rb`, output in `api.swagger.output_path`, generate with `api.swagger.generate_cmd`.

**Read an existing neighbouring spec first** and copy its helpers, auth setup, shared contexts, schema refs (`components/schemas`) and tags — never use a generic template.

Each spec covers: `path` + operation matching the route · every `parameter` (path, query, header, body) · `request_body` schema + realistic example for writes · one `response` block per status the endpoint can return (200/201/204/401/403/404/422 …) · `schema` matching the serializer exactly · realistic `example` values (fake data, no real customers) · auth header · tags for Swagger UI grouping.

Shape reminder (adapt to the project):
```ruby
require 'swagger_helper'

RSpec.describe 'Api::V1::Exports', type: :request do
  path '/api/v1/projects/{project_id}/exports' do
    parameter name: :project_id, in: :path, type: :integer, required: true

    post 'Create an export' do
      tags 'Exports'
      consumes 'application/json'
      produces 'application/json'
      parameter name: :payload, in: :body, schema: { '$ref' => '#/components/schemas/ExportRequest' }

      response '201', 'created' do
        schema '$ref' => '#/components/schemas/Export'
        run_test!
      end
      response '422', 'invalid format' do
        let(:payload) { { format: 'xls' } }
        run_test!
      end
    end
  end
end
```

Then: run the generate command → fix failures → confirm the endpoint appears in the output file.
